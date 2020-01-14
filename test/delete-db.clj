(require 'datomic.api)

(let [db-name (System/getenv "PEER_DB_NAME")
      _ (println "deleting datbase:" db-name)
      res (datomic.api/delete-database (str "datomic:dev://localhost:4334/" db-name))]
  (println "result:" res)
  (System/exit (if res 0 1)))