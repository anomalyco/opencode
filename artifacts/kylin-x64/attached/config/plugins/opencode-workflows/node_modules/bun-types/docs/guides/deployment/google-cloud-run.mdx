---
title: Deploy a Bun application on Google Cloud Run
sidebarTitle: Deploy on Google Cloud Run
mode: center
---

[Google Cloud Run](https://cloud.google.com/run) is a managed platform for deploying and scaling serverless applications. Google handles the infrastructure for you.

In this guide, we will deploy a Bun HTTP server to Google Cloud Run using a `Dockerfile`.

<Note>
	Before continuing, make sure you have:

    - A Bun application ready for deployment
    - A [Google Cloud account](https://cloud.google.com/) with billing enabled
    - [Google Cloud CLI](https://cloud.google.com/sdk/docs/install) installed and configured

</Note>

---

<Steps> 
<Step title={<span>Initialize <code>gcloud</code> by select/creating a project</span>}>

Make sure that you've initialized the Google Cloud CLI. This command logs you in, and prompts you to either select an existing project or create a new one.

For more help with the Google Cloud CLI, see the [official documentation](https://docs.cloud.google.com/sdk/gcloud/reference/init).

```bash terminal icon="terminal"
gcloud init
```

```txt
Welcome! This command will take you through the configuration of gcloud.

You must sign in to continue. Would you like to sign in (Y/n)? Y
You are signed in as [email@example.com].

Pick cloud project to use:
 [1] existing-bun-app-1234
 [2] Enter a project ID
 [3] Create a new project
Please enter numeric choice or text value (must exactly match list item): 3

Enter a Project ID. my-bun-app
Your current project has been set to: [my-bun-app]

The Google Cloud CLI is configured and ready to use!
```

</Step>
<Step title="(Optional) Store your project info in environment variables">
Set variables for your project ID and number so they're easier to reuse in the following steps.

```bash terminal icon="terminal"
PROJECT_ID=$(gcloud projects list --format='value(projectId)' --filter='name="my bun app"')
PROJECT_NUMBER=$(gcloud projects list --format='value(projectNumber)' --filter='name="my bun app"')

echo $PROJECT_ID $PROJECT_NUMBER
```

```txt
my-bun-app-... [PROJECT_NUMBER]
```

</Step> 
<Step title="Link a billing account">
List your available billing accounts and link one to your project:

```bash terminal icon="terminal"
gcloud billing accounts list
```

```txt
ACCOUNT_ID            NAME                OPEN  MASTER_ACCOUNT_ID
[BILLING_ACCOUNT_ID]  My Billing Account  True
```

Link your billing account to your project. Replace `[BILLING_ACCOUNT_ID]` with the ID of your billing account.

```bash terminal icon="terminal"
gcloud billing projects link $PROJECT_ID --billing-account=[BILLING_ACCOUNT_ID]
```

```txt
billingAccountName: billingAccounts/[BILLING_ACCOUNT_ID]
billingEnabled: true
name: projects/my-bun-app-.../billingInfo
projectId: my-bun-app-...
```

</Step> 
<Step title="Enable APIs and configure IAM roles"> 
Activate the necessary services and grant Cloud Build permissions:

```bash terminal icon="terminal"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member=serviceAccount:$PROJECT_NUMBER-compute@developer.gserviceaccount.com \
  --role=roles/run.builder
```

<Note>  
These commands enable Cloud Run (`run.googleapis.com`) and Cloud Build (`cloudbuild.googleapis.com`), which are required for deploying from source. Cloud Run runs your containerized app, while Cloud Build handles building and packaging it.

The IAM binding grants the Compute Engine service account (`$PROJECT_NUMBER-compute@developer.gserviceaccount.com`) permission to build and deploy images on your behalf.

</Note>

</Step>
<Step title="Add a Dockerfile">
Create a new `Dockerfile` in the root of your project. This file contains the instructions to initialize the container, copy your local project files into it, install dependencies, and start the application.

```docker Dockerfile icon="docker"
# Use the official Bun image to run the application
FROM oven/bun:latest

# Copy the package.json and bun.lock into the container
COPY package.json bun.lock ./

# Install the dependencies
RUN bun install --production --frozen-lockfile

# Copy the rest of the application into the container
COPY . .

# Run the application
CMD ["bun", "index.ts"]
```

<Note>
  Make sure that the start command corresponds to your application's entry point. This can also be `CMD ["bun", "run", "start"]` if you have a start script in your `package.json`.

This image installs dependencies and runs your app with Bun inside a container. If your app doesn't have dependencies, you can omit the `RUN bun install --production --frozen-lockfile` line.

</Note>

Create a new `.dockerignore` file in the root of your project. This file contains the files and directories that should be _excluded_ from the container image, such as `node_modules`. This makes your builds faster and smaller:

```docker .dockerignore icon="Docker"
node_modules
Dockerfile*
.dockerignore
.git
.gitignore
README.md
LICENSE
.vscode
.env
# Any other files or directories you want to exclude
```

</Step>
<Step title="Deploy your service"> 
Make sure you're in the directory containing your `Dockerfile`, then deploy directly from your local source:

<Note>
  Update the `--region` flag to your preferred region. You can also omit this flag to get an interactive prompt to
  select a region.
</Note>

```bash terminal icon="terminal"
gcloud run deploy my-bun-app --source . --region=us-west1 --allow-unauthenticated
```

```txt
Deploying from source requires an Artifact Registry Docker repository to store built containers. A repository named
[cloud-run-source-deploy] in region [us-west1] will be created.

Do you want to continue (Y/n)? Y

Building using Dockerfile and deploying container to Cloud Run service [my-bun-app] in project [my-bun-app-...] region [us-west1]
✓ Building and deploying... Done.
  ✓ Validating Service...
  ✓ Uploading sources...
  ✓ Building Container... Logs are available at [https://console.cloud.google.com/cloud-build/builds...].
  ✓ Creating Revision...
  ✓ Routing traffic...
  ✓ Setting IAM Policy...
Done.
Service [my-bun-app] revision [my-bun-app-...] has been deployed and is serving 100 percent of traffic.
Service URL: https://my-bun-app-....us-west1.run.app
```

</Step>
<Step title="Visit your live application">

🎉 Your Bun application is now live!

Visit the Service URL (`https://my-bun-app-....us-west1.run.app`) to confirm everything works as expected.

</Step>
</Steps>
