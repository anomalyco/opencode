<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
## Table of Contents

- [Learning web development](#learning-web-development)
  - [Goal of this training](#goal-of-this-training)
  - [Principles](#principles)
    - [Meta: learning about learning](#meta-learning-about-learning)
  - [Roadmap](#roadmap)
  - [Approach](#approach)
    - [Pick a powerful text editor and learn its ins and outs](#pick-a-powerful-text-editor-and-learn-its-ins-and-outs)
    - [Learn the ins and outs of one programming language](#learn-the-ins-and-outs-of-one-programming-language)
  - [Topic-specific materials](#topic-specific-materials)
      - [Best practices, attitude](#best-practices-attitude)
      - [Code architecture and design patterns](#code-architecture-and-design-patterns)
      - [DB and SQL](#db-and-sql)
      - [Dev environment, command line and Linux](#dev-environment-command-line-and-linux)
      - [Distributed systems and system architecture](#distributed-systems-and-system-architecture)
      - [Network, protocols, HTTP](#network-protocols-http)
      - [Project management](#project-management)
      - [Security](#security)
      - [Version control (git)](#version-control-git)
  - [Other lists](#other-lists)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

<!--TOC-->

# Learning web development

## Goal of this training

This training provides an opinionated ramp-up program for web developers.

Prerequisites: not much, just general knowledge about computers and the Internet.

## Principles

- Focus on the main stuff. A lot of things are learnt on the job anyway.
- Programming is not only about raw technical knowledge,
  it's also about best practices.
- Go wide and go deep.
- We learn by doing, so this training includes lots of exercises.
- A lot of videos are included, since they provide hands-on experiences. You
  can find a LOT more videos here: [hellerve/programming-talks](https://github.com/hellerve/programming-talks) and [talks that changed the way I think about programming](http://www.opowell.com/post/talks-that-changed-the-way-i-think-about-programming/)

Note: this is just a short selection of stuff listed in
[charlax/professional-programming](https://github.com/charlax/professional-programming).

### Meta: learning about learning

Feel free to checkout some of the articles about [Learning and memorizing](https://github.com/charlax/professional-programming#learning--memorizing)

- Create a learning plan with your learning priorities
- Consider using flashcards (see Anki for instance)
- Enjoy the learning experience!

## Roadmap

1. Start with a programming language.
2. Do a first pass at the web development environment (see introductory resources below)
    - HTTP and web architecture basics
    - Git
    - Docker and `docker-compose`
    - Command line
    - Text editor
3. Write a full-fledged exercise, get it reviewed.
4. Do the advanced topics

## Approach

### Pick a powerful text editor and learn its ins and outs

VSCode is a strong pick nowadays (I use and obviously prefer Vim :).

Make sure to spend a lot of time in your text editor, watch tutorials about
advanced features, install extensions, learn all the main keyboard shortcuts,
subscribe to mailing lists about it, etc.

You will spend most of your time within your text editor. Turn it into
a powerful ally!

### Learn the ins and outs of one programming language

A developer's main tool being the programming language, it is important to
achieve high proficiency in at least one of them.

I'd recommend starting with Python or TypeScript. For Python, you can have a look at my repo [charlax/python-education](https://github.com/charlax/python-education).

To ensure you have good command of the language, you should try out some of
those exercises:

- [Exercism](https://exercism.io/) (get free code reviews!)
- [Small Python exercises from charlax/python-education](https://github.com/charlax/python-education/tree/master/learning-python/exercises)
- [danistefanovic/build-your-own-x](https://github.com/danistefanovic/build-your-own-x) (for instance: build a [git in Python](https://wyag.thb.lt/))
- [Other list of exercises](https://github.com/charlax/python-education#exercises)

Watch some videos related to your language:

- 🎞 [Top 10 Must-Watch PyCon Talks](https://realpython.com/must-watch-pycon-talks/)

Learn how to handle:

- Regexes
    - Do exercises, for instance [RegexOne](https://regexone.com/) or [HackerRank](https://www.hackerrank.com/domains/regex).
- Functional programming
    - [Functional Programming Fundamentals](https://www.matthewgerstman.com/tech/functional-programming-fundamentals/)
- Design patterns
    - E.g. in [Python](https://www.toptal.com/python/python-design-patterns)
    - [faif/python-patterns](https://github.com/faif/python-patterns)
    - 🎞 [Design Patterns in Plain English](https://www.youtube.com/watch?v=NU_1StN5Tkk&ab_channel=ProgrammingwithMosh)
- Tests
    - [Why bother writing tests at all?](https://dave.cheney.net/2019/05/14/why-bother-writing-tests-at-all)
- Crazy things in languages
    - 🎞 [Wat](https://www.destroyallsoftware.com/talks/wat)

If you have time, learn more programming languages, starting with some that are
*very* different from your main one:

- Haskell
- Clojure
- Kotlin
- Rust
- Assembly

## Topic-specific materials

#### Best practices, attitude

Read one of those:

- 📖 [The Pragmatic Programmer: From Journeyman to
  Master](https://pragprog.com/titles/tpp20/): hands-on the most inspiring and useful book I've read about programming.
- 📖 [Code Complete: A Practical Handbook of Software
  Construction](http://www.amazon.com/Code-Complete-Practical-Handbook-Construction/dp/0735619670): a nice addition to The Pragmatic Programmer, gives you the necessary framework to talk about code.
- [Ten Principles for Growth as an Engineer](https://medium.com/@daniel.heller/ten-principles-for-growth-69015e08c35b), Dan Heller

Read the resources listed under [Must-read articles](https://github.com/charlax/professional-programming#must-read-articles).

#### Code architecture and design patterns

Introduction:

- Learn about OOP basics: inheritance, abstract/concrete, public/private
- Learn about DDD (domain driven design), SOLID, MVC, Clean Architecture
- [An introduction to software design patterns](https://www.coengoedegebure.com/introduction-to-software-design-patterns/). All those patterns are not useful in all languages, but they're applied in most software, so it's important to know about them.
    - Builder
    - Factory
    - Singleton
    - Adapter
    - Facade
    - Chain of Responsibility
    - Command
    - Observer
    - State
    - Strategy
    - Visitor
- 🎞 [Design Patterns in Plain English](https://www.youtube.com/watch?v=NU_1StN5Tkk&ab_channel=ProgrammingwithMosh)

Advanced:

- Wander in the [Software Architecture Guide](https://martinfowler.com/architecture/)
- 🎞 [On the Spectrum of Abstraction](https://www.youtube.com/watch?v=mVVNJKv9esE&ab_channel=ReactEurope)
- 🎞 [Simple Made Easy](https://www.infoq.com/presentations/Simple-Made-Easy/)
- 🎞 [Zebras All the Way Down](https://youtu.be/fE2KDzZaxvE), Bryan Cantrill

#### DB and SQL

Introduction:

- Learn basic and advanced SQL: joins, indexes, subqueries.
- Install Postgres and play with it.
- [Do those postgres exercises](https://pgexercises.com/)

Advanced:

- Learn about ORM
    - 🎞 [Watch this Python introduction to ORMs](https://www.youtube.com/watch?v=P141KRbxVKc&ab_channel=PyCon2014) (with SQLAlchemy)

#### Dev environment, command line and Linux

Introduction:

- [jlevy/the-art-of-command-line](https://github.com/jlevy/the-art-of-command-line): master the command line, in one page
- Check the missing semester:
    - https://missing.csail.mit.edu/2020/course-shell/
    - https://missing.csail.mit.edu/2020/shell-tools/
- [Linux Productivity Tools](https://www.usenix.org/sites/default/files/conference/protected-files/lisa19_maheshwari.pdf)
- Do shell exercises, for instance on [Exercism](https://exercism.io/tracks/bash), [TLDP](https://tldp.org/LDP/abs/html/exercises.html), [HackerRank](https://www.hackerrank.com/domains/shell).
- Learn about Docker, follow the [Official Docker Tutorial](https://docs.docker.com/get-started/)
- Learn about Makefile, follow the [Official introduction to
  Makefiles](https://www.gnu.org/software/make/manual/html_node/Introduction.html).

Advanced:

- Install/use some of those tools: https://github.com/jondot/awesome-devenv
- Write your own dotfiles, taking inspiration from [Awesome Dotfiles](https://github.com/webpro/awesome-dotfiles) (you can
  checkout mines: https://github.com/charlax/dotfiles)
- 🎞 [8 super heroic Linux commands that you probably aren't using](https://www.youtube.com/watch?v=Zuwa8zlfXSY&ab_channel=EngineerMan)
- 🎞 [Containers From Scratch](https://www.youtube.com/watch?v=8fi7uSYlOdc&ab_channel=GOTOConferences)

#### Distributed systems and system architecture

Introduction:

- [donnemartin/system-design-primer](https://github.com/donnemartin/system-design-primer): learn how to design large-scale systems.

Advanced:

- Consider reading 📖 [Designing Data-Intensive Applications](https://dataintensive.net/).
- [The Log: What every software engineer should know about real-time data's unifying abstraction](https://engineering.linkedin.com/distributed-systems/log-what-every-software-engineer-should-know-about-real-time-datas-unifying)
- 🎞 [Mastering Chaos - A Netflix Guide to Microservices](https://www.youtube.com/watch?v=CZ3wIuvmHeM&ab_channel=InfoQ) (by Netflix)

Concepts to look into:

- CAP theorem
- Weak/strong/eventual consistency
- Fail-over/replication
- Load balancer: active-active, active-passive
- Horizontal vs vertical scaling
- Reverse proxy, load balancer
- DB: RDBMS vs. NoSQL, replication, sharding, master-master, denormalization
- Cache: client caching in browsers, CDN, HTTP headers, object cache, db cache
- Asynchronism: message queues, back pressure
- Monitoring and alerting best practices

#### Network, protocols, HTTP

Introduction:

- [How Does the Internet Work?](https://web.stanford.edu/class/msande91si/www-spr04/readings/week1/InternetWhitepaper.htm)
- [vasanthk/how-web-works](https://github.com/vasanthk/how-web-works): what happens behind the scenes when we type www.google.com in a browser?

Advanced:

- Learn about the basics of TCP and UDP
- Learn the basics of the HTTP protocol: header, verb, status code, TLS, Rest APIs, etc.
    - 🎞 [Qu'est ce que le HTTP ?](https://grafikart.fr/tutoriels/http-1062), Grafikart
- Learn about important web-related protocols: DNS, SMTP, SSH

#### Project management

Introduction:

- [Efficient Software Project Management at its Roots](https://blog.pragmaticengineer.com/efficient-software-project-management-at-its-roots/)
- [How to Lead a Project - as a Software Engineer](https://blog.pragmaticengineer.com/how-to-lead-a-project-in-software-development/)

Advanced:

- [TechnicalDebt](https://martinfowler.com/bliki/TechnicalDebt.html)
- Checkout this section on [charlax/engineering-management](https://github.com/charlax/engineering-management#project-management)

#### Security

Introduction:

- Learn about the OWASP Top 10

Advanced:

- Consider reading 📖 [Penetration Testing](https://nostarch.com/pentesting).

#### Version control (git)

Introduction:

- [Resources to learn Git](https://try.github.io/)
- 🎞 [Learn Git In 15 Minutes - YouTube](https://www.youtube.com/watch?v=USjZcfj8yxE&ab_channel=ColtSteele)
- 🎞 [Introduction to Git](https://www.youtube.com/watch?v=ZDR433b0HJY&ab_channel=InfoQ) with Scott Chacon of GitHub

Advanced topics:

- `git rebase`
- `git stash`
- `git revert`
- The dangers of `git push --force`

## Other lists

- [The Missing Semester of Your CS Education](https://missing.csail.mit.edu/) (MIT).
- [What every computer science major should know](http://matt.might.net/articles/what-cs-majors-should-know/)
- [Teach Yourself Computer Science](https://teachyourselfcs.com/)
- https://github.com/charlax/professional-programming
- [microsoft/Web-Dev-For-Beginners](https://github.com/microsoft/Web-Dev-For-Beginners): 24 Lessons, 12 Weeks, Get Started as a Web Developer
