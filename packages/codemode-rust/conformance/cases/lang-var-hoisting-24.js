function* gen() { var t = 1; yield t; var t = 2; yield t } return [...gen()]
