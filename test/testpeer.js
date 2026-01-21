let assert = require("assert");
let client = require("../index.js");
let crypto = require("crypto");
let transit = require("transit-js");
let path = require("path");
let { execSync, spawn } = require("child_process");
let common = require("./common");
let jsedn = require("jsedn");

const dbName = "test";
const accessKey = "test";
const secret = "test";

// Docker configuration
const testId = crypto.randomUUID().slice(0, 8);
const NETWORK_NAME = `datomic-test-${testId}`;
const TRANSACTOR_CONTAINER = `datomic-transactor-${testId}`;
const PEER_SERVER_CONTAINER = `datomic-peer-server-${testId}`;
const BASE_IMAGE = "rsdio/datomic-docker";
const TRANSACTOR_IMAGE = "rsdio/datomic-transactor";
const PEER_SERVER_IMAGE = "rsdio/datomic-peer-server";

let peerServerPort = null;

const config = {
  serverType: "client",
  accessKey: accessKey,
  secret: secret,
  dbName: dbName,
};

const schema = [
  transit.map([
    transit.keyword("db/ident"),
    transit.keyword("movie/title"),
    transit.keyword("db/valueType"),
    transit.keyword("db.type/string"),
    transit.keyword("db/cardinality"),
    transit.keyword("db.cardinality/one"),
    transit.keyword("db/doc"),
    "The title of the movie",
  ]),
  transit.map([
    transit.keyword("db/ident"),
    transit.keyword("movie/genre"),
    transit.keyword("db/valueType"),
    transit.keyword("db.type/string"),
    transit.keyword("db/cardinality"),
    transit.keyword("db.cardinality/one"),
    transit.keyword("db/doc"),
    "The genre of the movie",
  ]),
  transit.map([
    transit.keyword("db/ident"),
    transit.keyword("movie/release-year"),
    transit.keyword("db/valueType"),
    transit.keyword("db.type/long"),
    transit.keyword("db/cardinality"),
    transit.keyword("db.cardinality/one"),
    transit.keyword("db/doc"),
    "The year the movie was released in theaters",
  ]),
];

let connection = null;

function dockerExec(command, options = {}) {
  console.log(`Executing: ${command}`);
  try {
    return execSync(command, {
      encoding: "utf8",
      stdio: options.silent ? "pipe" : "inherit",
      ...options,
    });
  } catch (error) {
    if (!options.ignoreError) {
      throw error;
    }
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForContainer(containerName, logPattern, timeoutMs = 60000) {
  const startTime = Date.now();
  console.log(`Waiting for container ${containerName} to be ready...`);

  while (Date.now() - startTime < timeoutMs) {
    try {
      const logs = execSync(`docker logs ${containerName} 2>&1`, {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      if (logs.includes(logPattern)) {
        console.log(`Container ${containerName} is ready`);
        return true;
      }
    } catch (e) {
      // Container might not be ready yet
    }
    await sleep(1000);
  }
  throw new Error(`Timeout waiting for container ${containerName}`);
}

async function waitForPort(host, port, timeoutMs = 60000) {
  const startTime = Date.now();
  console.log(`Waiting for ${host}:${port} to be available...`);

  while (Date.now() - startTime < timeoutMs) {
    try {
      const net = require("net");
      await new Promise((resolve, reject) => {
        const socket = new net.Socket();
        socket.setTimeout(1000);
        socket.on("connect", () => {
          socket.destroy();
          resolve();
        });
        socket.on("timeout", () => {
          socket.destroy();
          reject(new Error("timeout"));
        });
        socket.on("error", (err) => {
          socket.destroy();
          reject(err);
        });
        socket.connect(port, host);
      });
      console.log(`${host}:${port} is available`);
      return true;
    } catch (e) {
      await sleep(1000);
    }
  }
  const peerLog = getPeerServerLog();
  if (peerLog) {
    console.log("Peer server log output (on port timeout):");
    console.log(peerLog);
  }
  throw new Error(`Timeout waiting for ${host}:${port}`);
}

function isPeerServerRunning(containerName) {
  try {
    const result = execSync(
      `docker exec ${containerName} pgrep -f "peer-server"`,
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    );
    return result.trim().length > 0;
  } catch (e) {
    return false;
  }
}

async function waitForTlsReady(host, port, timeoutMs = 60000) {
  const https = require("https");
  const startTime = Date.now();
  console.log(`Waiting for TLS to be ready on ${host}:${port}...`);

  while (Date.now() - startTime < timeoutMs) {
    try {
      await new Promise((resolve, reject) => {
        const req = https.request(
          {
            hostname: host,
            port: port,
            path: "/health",
            method: "GET",
            rejectUnauthorized: false,
            timeout: 5000,
          },
          (res) => {
            res.on("data", () => {});
            res.on("end", () => resolve());
          },
        );
        req.on("error", (err) => reject(err));
        req.on("timeout", () => {
          req.destroy();
          reject(new Error("timeout"));
        });
        req.end();
      });
      console.log(`TLS connection to ${host}:${port} is ready`);
      return true;
    } catch (e) {
      console.log(`TLS connection attempt failed: ${e.message}`);
      // Check if the process is still running before continuing to wait
      if (!isPeerServerRunning(TRANSACTOR_CONTAINER)) {
        // Try to get error output from the peer server log file
        const peerLog = getPeerServerLog();
        if (peerLog) {
          console.log("Peer server log output:");
          console.log(peerLog);
        }
        throw new Error("Peer server process is not running in container");
      }
      await sleep(1000);
    }
  }
  const peerLog = getPeerServerLog();
  if (peerLog) {
    console.log("Peer server log output (on TLS timeout):");
    console.log(peerLog);
  }
  throw new Error(`Timeout waiting for TLS on ${host}:${port}`);
}

function createDockerNetwork() {
  console.log(`Creating Docker network: ${NETWORK_NAME}`);
  dockerExec(`docker network create ${NETWORK_NAME}`, { silent: true });
}

function removeDockerNetwork() {
  console.log(`Removing Docker network: ${NETWORK_NAME}`);
  dockerExec(`docker network rm ${NETWORK_NAME}`, {
    ignoreError: true,
    silent: true,
  });
}

async function startTransactor() {
  console.log(`Starting transactor container: ${TRANSACTOR_CONTAINER}`);
  peerServerPort = await getRandomPort();
  dockerExec(
    `docker run -d ` +
      `--name ${TRANSACTOR_CONTAINER} ` +
      `--network ${NETWORK_NAME} ` +
      `--network-alias datomic-transactor ` +
      `--publish 127.0.0.1:${peerServerPort}:8998 ` +
      `-e DATOMIC_STORAGE=dev ` +
      `${TRANSACTOR_IMAGE}`,
  );
  config.endpoint = `127.0.0.1:${peerServerPort}`;
}

function stopTransactor() {
  console.log(`Stopping transactor container: ${TRANSACTOR_CONTAINER}`);
  dockerExec(`docker stop ${TRANSACTOR_CONTAINER}`, {
    ignoreError: true,
    silent: true,
  });
  dockerExec(`docker rm ${TRANSACTOR_CONTAINER}`, {
    ignoreError: true,
    silent: true,
  });
}

function createDatabase() {
  console.log("Creating database using create-db.clj script...");
  const scriptPath = path.resolve(__dirname, "create-db.clj");

  dockerExec(
    `docker cp ${scriptPath} ${TRANSACTOR_CONTAINER}:/tmp/create-db.clj`,
  );
  dockerExec(
    `docker exec -e TRANSACTOR_HOST=localhost -e PEER_DB_NAME=${dbName} ${TRANSACTOR_CONTAINER} /opt/datomic/bin/run /tmp/create-db.clj`,
  );
  console.log("Database created successfully");
}

function deleteDatabase() {
  console.log("Deleting database using delete-db.clj script...");
  const scriptPath = path.resolve(__dirname, "delete-db.clj");

  dockerExec(
    `docker cp ${scriptPath} ${TRANSACTOR_CONTAINER}:/tmp/delete-db.clj`,
  );
  dockerExec(
    `docker exec -e TRANSACTOR_HOST=localhost -e PEER_DB_NAME=${dbName} ${TRANSACTOR_CONTAINER} /opt/datomic/bin/run /tmp/delete-db.clj`,
  );
}

function getRandomPort() {
  const net = require("net");
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const port = srv.address().port;
      srv.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

const PEER_SERVER_LOG = "/tmp/peer-server.log";

async function startPeerServer() {
  console.log(`Starting peer server`);

  // Use sh -c to redirect stdout/stderr to a log file so we can debug failures
  // The peer server output would otherwise be lost with docker exec -d
  // -h 0.0.0.0 binds to all interfaces so it's reachable through Docker port forwarding
  dockerExec(
    `docker exec -d ` +
      `${TRANSACTOR_CONTAINER} sh -c '/opt/datomic/bin/run -m datomic.peer-server ` +
      `-h 0.0.0.0 -a ${accessKey},${secret} -d ${dbName},datomic:dev://localhost:4334/${dbName} ` +
      `> ${PEER_SERVER_LOG} 2>&1'`,
  );
}

function getPeerServerLog() {
  try {
    const log = execSync(
      `docker exec ${TRANSACTOR_CONTAINER} cat ${PEER_SERVER_LOG} 2>/dev/null`,
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    );
    return log;
  } catch (e) {
    return null;
  }
}

function stopPeerServer() {
  console.log(`Stopping peer server container: ${PEER_SERVER_CONTAINER}`);
  dockerExec(`docker stop ${PEER_SERVER_CONTAINER}`, {
    ignoreError: true,
    silent: true,
  });
  dockerExec(`docker rm ${PEER_SERVER_CONTAINER}`, {
    ignoreError: true,
    silent: true,
  });
}

async function setupDocker() {
  createDockerNetwork();
  await startTransactor();

  // Wait for transactor to be ready
  await waitForContainer(TRANSACTOR_CONTAINER, "System started", 120000);
  await sleep(2000); // Give it a bit more time to fully initialize

  // Create the database
  createDatabase();

  // Start peer server
  await startPeerServer();

  // Give the peer server a moment to start, then verify it's running
  await sleep(2000);
  if (!isPeerServerRunning(TRANSACTOR_CONTAINER)) {
    // Process may have exited immediately - check the peer server log file
    const peerLog = getPeerServerLog();
    if (peerLog) {
      console.log("Peer server log output:");
      console.log(peerLog);
    } else {
      console.log("No peer server log available");
    }
    throw new Error(
      "Peer server process failed to start or exited immediately",
    );
  }
  console.log("Peer server process is running in container");

  // Wait for TCP port to be available
  await waitForPort("localhost", peerServerPort, 60000);

  // Wait for TLS to be fully ready (this catches the case where the port is open
  // but TLS handshake fails because the server isn't actually ready)
  await waitForTlsReady("127.0.0.1", peerServerPort, 60000);
}

function cleanupDocker() {
  console.log("Cleaning up Docker resources...");
  deleteDatabase();
  stopPeerServer();
  stopTransactor();
  removeDockerNetwork();
}

describe(
  "peer-server test suite",
  common.testSuite(
    async function (schema) {
      await setupDocker();
      let connection = await client.connect(config);
      let schema2 = jsedn.parse(jsedn.encode(schema));
      schema2.val[0].keys.push(jsedn.parse(":db/index"));
      schema2.val[0].vals.push(true);
      await connection.transact({ txData: schema2 });
      assert.strictEqual(connection.getServerType(), "peer-server");
      return connection;
    },
    async function () {
      cleanupDocker();
      console.log("Cleanup complete");
    },
    config,
  ),
);
