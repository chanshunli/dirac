(ns suite01.scenarios.no-dirac-feature
  (:require [dirac.fixtures.devtools :refer [init-devtools!]]))

(init-devtools! {:do-not-install-devtools true})