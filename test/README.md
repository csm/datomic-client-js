# Testing

To run tests, you'll need to have:

1. A Datomic Cloud system running, and have a bastion connection established.
2. A Datomic Pro system running locally, with peer-server running locally on port 8001.

You will pass information about your setup to the test runner via environment variables. The environment variables are (all required):

* CLOUD_DB_NAME: the database name for cloud tests. This database should not exist in your system, and it will be
  deleted after the tests run.
* CLOUD_SYSTEM: your Datomic Cloud system name.
* CLOUD_REGION: your Datomic Cloud AWS region.
* CLOUD_PROXY_PORT: your Datomic Cloud socks proxy port (usually, 8182).
* DATOMIC_PRO_HOME: the absolute path to the Datomic Pro distribution (there should be a file `${DATOMIC_PRO_HOME}/bin/run`).
* JAVA_HOME: set to your Java installation directory (must be a Java version supported by your Datomic version, usually Java 8).

Note that especially with Cloud, you cannot run tests repeatedly with the same DB name within a short time window,
because the system will still think the DB from the old run still exists.