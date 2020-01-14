# Testing

To run tests, you'll need to have:

1. A Datomic Cloud system running, and have a bastion connection established.
2. A Datomic Pro transactor running locally with the dev protocol.

You will pass information about your setup to the test runner via environment variables. The environment variables are (all required):

* CLOUD_SYSTEM: your Datomic Cloud system name.
* CLOUD_REGION: your Datomic Cloud AWS region.
* CLOUD_PROXY_PORT: your Datomic Cloud socks proxy port (usually, 8182).
* DATOMIC_PRO_HOME: the absolute path to the Datomic Pro distribution (there should be a file `${DATOMIC_PRO_HOME}/bin/run`).
* JAVA_HOME: set to your Java installation directory (must be a Java version supported by your Datomic version, usually Java 8).

Note that the peer-server tests need to launch the peer-server process and then tear it down again, but the tear-it-down part doesn't seem to work; once all the tests pass, you'll need to kill the process yourself.
