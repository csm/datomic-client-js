(require 'datomic.api)

(let [db-name (System/getenv "PEER_DB_NAME")
      transactor-host (or (System/getenv "TRANSACTOR_HOST") "localhost")
      uri (str "datomic:dev://" transactor-host ":4334/" db-name "?password=datomic")
      _ (println "deleting database:" uri)
      res (datomic.api/delete-database uri)]
  (println "result:" res)
  (System/exit (if res 0 1)))
