---
title: Run Bun as a daemon with PM2
sidebarTitle: PM2 with Bun
mode: center
---

[PM2](https://pm2.keymetrics.io/) is a popular process manager that manages and runs your applications as daemons (background processes).

It offers features like process monitoring, automatic restarts, and scaling. Using a process manager is common when deploying a Bun application on a cloud-hosted virtual private server (VPS), as it:

- Keeps your application running continuously.
- Ensures high availability and reliability of your application.
- Monitors and manages multiple processes.
- Simplifies the deployment process.

---

You can use PM2 with Bun in two ways: as a CLI option or in a configuration file.

### With `--interpreter`

To start your application with PM2 and Bun as the interpreter, open your terminal and run the following command:

```bash terminal icon="terminal"
pm2 start --interpreter ~/.bun/bin/bun index.ts
```

---

### With a configuration file

Alternatively, you can create a PM2 configuration file. Create a file named `pm2.config.js` in your project directory and add the following content.

```js pm2.config.js icon="file-code"
module.exports = {
  name: "app", // Name of your application
  script: "index.ts", // Entry point of your application
  interpreter: "bun", // Bun interpreter
  env: {
    PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}`, // Add "~/.bun/bin/bun" to PATH
  },
};
```

---

After saving the file, you can start your application with PM2

```bash terminal icon="terminal"
pm2 start pm2.config.js
```

---

That’s it! Your JavaScript/TypeScript web server is now running as a daemon with PM2 using Bun as the interpreter.
