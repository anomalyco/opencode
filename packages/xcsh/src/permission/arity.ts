export namespace BashArity {
  export function prefix(tokens: string[]) {
    for (let len = tokens.length; len > 0; len--) {
      const prefix = tokens.slice(0, len).join(" ")
      const arity = ARITY[prefix]
      if (arity !== undefined) return tokens.slice(0, arity)
    }
    if (tokens.length === 0) return []
    return tokens.slice(0, 1)
  }

  /* Generated with following prompt:
You are generating a dictionary of command-prefix arities for bash-style commands.
This dictionary is used to identify the "human-understandable command" from an input shell command.### **RULES (follow strictly)**1. Each entry maps a **command prefix string → number**, representing how many **tokens** define the command.
2. **Flags NEVER count as tokens**. Only subcommands count.
3. **Longest matching prefix wins**.
4. **Only include a longer prefix if its arity is different from what the shorter prefix already implies**.   * Example: If `git` is 2, then do **not** include `git checkout`, `git commit`, etc. unless they require *different* arity.
5. The output must be a **single JSON object**. Each entry should have a comment with an example real world matching command. DO NOT MAKE ANY OTHER COMMENTS. Should be alphabetical
6. Include the **most commonly used commands** across many stacks and languages. More is better.### **Semantics examples*** `touch foo.txt` → `touch` (arity 1, explicitly listed)
* `git checkout main` → `git checkout` (because `git` has arity 2)
* `npm install` → `npm install` (because `npm` has arity 2)
* `npm run dev` → `npm run dev` (because `npm run` has arity 3)
* `python script.py` → `python script.py` (default: whole input, not in dictionary)### **Now generate the dictionary.**
*/
  const ARITY: Record<string, number> = {
    cat: 1, // cat file.txt
    cd: 1, // cd /path/to/dir
    chmod: 1, // chmod 755 script.sh
    chown: 1, // chown user:group file.txt
    cp: 1, // cp source.txt dest.txt
    echo: 1, // echo "hello world"
    env: 1, // env
    export: 1, // export PATH=/usr/bin
    grep: 1, // grep pattern file.txt
    kill: 1, // kill 1234
    killall: 1, // killall process
    ln: 1, // ln -s source target
    ls: 1, // ls -la
    mkdir: 1, // mkdir new-dir
    mv: 1, // mv old.txt new.txt
    ps: 1, // ps aux
    pwd: 1, // pwd
    rm: 1, // rm file.txt
    rmdir: 1, // rmdir empty-dir
    sleep: 1, // sleep 5
    source: 1, // source ~/.bashrc
    tail: 1, // tail -f log.txt
    touch: 1, // touch file.txt
    unset: 1, // unset VAR
    which: 1, // which node
    aws: 3, // aws s3 ls
    az: 3, // az storage blob list
    bazel: 2, // bazel build
    brew: 2, // brew install node
    bun: 2, // bun install
    "bun run": 3, // bun run dev
    "bun x": 3, // bun x vite
    cargo: 2, // cargo build
    "cargo add": 3, // cargo add tokio
    "cargo run": 3, // cargo run main
    cdk: 2, // cdk deploy
    cf: 2, // cf push app
    cmake: 2, // cmake build
    composer: 2, // composer require laravel
    consul: 2, // consul members
    "consul kv": 3, // consul kv get config/app
    crictl: 2, // crictl ps
    deno: 2, // deno run server.ts
    "deno task": 3, // deno task dev
    doctl: 3, // doctl kubernetes cluster list
    docker: 2, // docker run nginx
    "docker builder": 3, // docker builder prune
    "docker compose": 3, // docker compose up
    "docker container": 3, // docker container ls
    "docker image": 3, // docker image prune
    "docker network": 3, // docker network inspect
    "docker volume": 3, // docker volume ls
    eksctl: 2, // eksctl get clusters
    "eksctl create": 3, // eksctl create cluster
    firebase: 2, // firebase deploy
    flyctl: 2, // flyctl deploy
    gcloud: 3, // gcloud compute instances list
    gh: 3, // gh pr list
    git: 2, // git checkout main
    "git config": 3, // git config user.name
    "git remote": 3, // git remote add origin
    "git stash": 3, // git stash pop
    go: 2, // go build
    gradle: 2, // gradle build
    helm: 2, // helm install mychart
    heroku: 2, // heroku logs
    hugo: 2, // hugo new site blog
    ip: 2, // ip link show
    "ip addr": 3, // ip addr show
    "ip link": 3, // ip link set eth0 up
    "ip netns": 3, // ip netns exec foo bash
    "ip route": 3, // ip route add default via 1.1.1.1
    kind: 2, // kind delete cluster
    "kind create": 3, // kind create cluster
    kubectl: 2, // kubectl get pods
    "kubectl kustomize": 3, // kubectl kustomize overlays/dev
    "kubectl rollout": 3, // kubectl rollout restart deploy/api
    kustomize: 2, // kustomize build .
    make: 2, // make build
    mc: 2, // mc ls myminio
    "mc admin": 3, // mc admin info myminio
    minikube: 2, // minikube start
    mongosh: 2, // mongosh test
    mysql: 2, // mysql -u root
    mvn: 2, // mvn compile
    ng: 2, // ng generate component home
    npm: 2, // npm install
    "npm exec": 3, // npm exec vite
    "npm init": 3, // npm init vue
    "npm run": 3, // npm run dev
    "npm view": 3, // npm view react version
    nvm: 2, // nvm use 18
    nx: 2, // nx build
    openssl: 2, // openssl genrsa 2048
    "openssl req": 3, // openssl req -new -key key.pem
    "openssl x509": 3, // openssl x509 -in cert.pem
    pip: 2, // pip install numpy
    pipenv: 2, // pipenv install flask
    pnpm: 2, // pnpm install
    "pnpm dlx": 3, // pnpm dlx create-next-app
    "pnpm exec": 3, // pnpm exec vite
    "pnpm run": 3, // pnpm run dev
    poetry: 2, // poetry add requests
    podman: 2, // podman run alpine
    "podman container": 3, // podman container ls
    "podman image": 3, // podman image prune
    psql: 2, // psql -d mydb
    pulumi: 2, // pulumi up
    "pulumi stack": 3, // pulumi stack output
    pyenv: 2, // pyenv install 3.11
    python: 2, // python -m venv env
    rake: 2, // rake db:migrate
    rbenv: 2, // rbenv install 3.2.0
    "redis-cli": 2, // redis-cli ping
    rustup: 2, // rustup update
    serverless: 2, // serverless invoke
    sfdx: 3, // sfdx force:org:list
    skaffold: 2, // skaffold dev
    sls: 2, // sls deploy
    sst: 2, // sst deploy
    swift: 2, // swift build
    systemctl: 2, // systemctl restart nginx
    terraform: 2, // terraform apply
    "terraform workspace": 3, // terraform workspace select prod
    tmux: 2, // tmux new -s dev
    turbo: 2, // turbo run build
    ufw: 2, // ufw allow 22
    vault: 2, // vault login
    "vault auth": 3, // vault auth list
    "vault kv": 3, // vault kv get secret/api
    vercel: 2, // vercel deploy
    volta: 2, // volta install node
    wp: 2, // wp plugin install
    yarn: 2, // yarn add react
    "yarn dlx": 3, // yarn dlx create-react-app
    "yarn run": 3, // yarn run dev
  }
}
