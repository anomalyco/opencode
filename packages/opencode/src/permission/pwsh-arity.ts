export namespace PwshArity {
  export function prefix(tokens: string[]) {
    for (let len = tokens.length; len > 0; len--) {
      const prefix = tokens.slice(0, len).join(" ").toLowerCase()
      const arity = ARITY[prefix]
      if (arity !== undefined) return tokens.slice(0, arity)
    }
    if (tokens.length === 0) return []
    return tokens.slice(0, 1)
  }

  /* PowerShell command arity table
   * PowerShell cmdlets (Verb-Noun pattern) → arity 1
   * Common aliases → arity 1
   * External tools → same arities as BashArity
   */
  const ARITY: Record<string, number> = {
    // PowerShell common aliases → arity 1
    cat: 1, // cat file.txt (Get-Content)
    cd: 1, // cd C:\Users
    chdir: 1, // chdir C:\Users
    clear: 1, // clear (Clear-Host)
    cls: 1, // cls (Clear-Host)
    copy: 1, // copy source.txt dest.txt
    cp: 1, // cp source.txt dest.txt (Copy-Item)
    cpi: 1, // cpi source.txt dest.txt (Copy-Item)
    del: 1, // del file.txt (Remove-Item)
    dir: 1, // dir C:\ (Get-ChildItem)
    echo: 1, // echo "hello" (Write-Output)
    erase: 1, // erase file.txt (Remove-Item)
    foreach: 1, // foreach ($item in $items) {...}
    gc: 1, // gc file.txt (Get-Content)
    gci: 1, // gci C:\ (Get-ChildItem)
    ls: 1, // ls C:\ (Get-ChildItem)
    measure: 1, // measure (Measure-Object)
    mi: 1, // mi old.txt new.txt (Move-Item)
    mkdir: 1, // mkdir new-dir
    move: 1, // move old.txt new.txt
    mv: 1, // mv old.txt new.txt (Move-Item)
    ni: 1, // ni file.txt (New-Item)
    pwd: 1, // pwd (Get-Location)
    rd: 1, // rd empty-dir (Remove-Item)
    ri: 1, // ri file.txt (Remove-Item)
    rm: 1, // rm file.txt (Remove-Item)
    rmdir: 1, // rmdir empty-dir
    sc: 1, // sc file.txt content (Set-Content)
    select: 1, // select (Select-Object)
    sl: 1, // sl C:\ (Set-Location)
    sort: 1, // sort (Sort-Object)
    type: 1, // type file.txt (Get-Content)
    where: 1, // where (Where-Object)
    write: 1, // write "hello" (Write-Output)
    ac: 1, // ac file.txt content (Add-Content)
    clc: 1, // clc file.txt (Clear-Content)
    ren: 1, // ren old.txt new.txt (Rename-Item)
    rni: 1, // rni old.txt new.txt (Rename-Item)
    ii: 1, // ii file.txt (Invoke-Item)
    gi: 1, // gi HKCU:\Software (Get-Item - can access registry!)
    gp: 1, // gp HKCU:\Software\Key Name (Get-ItemProperty)
    sp: 1, // sp HKCU:\Software\Key Name Value (Set-ItemProperty)
    saps: 1, // saps notepad.exe (Start-Process)
    spps: 1, // spps -Name notepad (Stop-Process)
    spsv: 1, // spsv ServiceName (Stop-Service)
    sasv: 1, // sasv ServiceName (Start-Service)
    rsv: 1, // rsv ServiceName (Restart-Service)
    iex: 1, // iex script.ps1 (Invoke-Expression - DANGEROUS!)
    icm: 1, // icm scriptblock (Invoke-Command - DANGEROUS!)
    iwr: 1, // iwr https://example.com (Invoke-WebRequest)
    irm: 1, // irm https://example.com/script.ps1 (Invoke-RestMethod)
    curl: 1, // curl https://example.com (alias for Invoke-WebRequest)
    wget: 1, // wget https://example.com (alias for Invoke-WebRequest)
    epcsv: 1, // epcsv data.csv (Export-Csv)
    ipcsv: 1, // ipcsv data.csv (Import-Csv)
    sajb: 1, // sajb scriptblock (Start-Job)

    // External tools called from PowerShell (same as BashArity)
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
    dotnet: 2, // dotnet build
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
