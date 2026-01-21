(require 'datomic.api)

(let [db-name (or (System/getenv "PEER_DB_NAME") "test")
      transactor-host (or (System/getenv "TRANSACTOR_HOST") "localhost")
      uri (str "datomic:dev://" transactor-host ":4334/" db-name "?password=datomic")
      _ (println "creating database:" uri)
      res (datomic.api/create-database uri)]
  (println "result:" res)
  (System/exit (if res 0 1)))
