<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
## Table of Contents

- [Database anti-patterns](#database-anti-patterns)
  - [Using `VARCHAR` instead of `TEXT` (PostgreSQL)](#using-varchar-instead-of-text-postgresql)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

# Database anti-patterns

## Using `VARCHAR` instead of `TEXT` (PostgreSQL)

Unless you absolutely restrict the width of a text column for data consistency
reason, don't do it.

This
[benchmark](http://www.depesz.com/2010/03/02/charx-vs-varcharx-vs-varchar-vs-text/)
shows that there's fundamentally no difference in performance between
`char(n)`, `varchar(n)`, `varchar` and `text`. Here's why you should pick
`text`:

- `char(n)`: takes more space than necessary when dealing with values shorter
  than n.
- `varchar(n)`: it's difficult to change the width.
- `varchar` is just like `text`.
- `text` does not have the width problem that `char(n)` and `varchar(n)` and
  has a cleaner name than `varchar`.
