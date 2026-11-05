---
title: Read and write data to MongoDB using Mongoose and Bun
sidebarTitle: Mongoose with Bun
mode: center
---

MongoDB and Mongoose work out of the box with Bun. This guide assumes you've already installed MongoDB and are running it as background process/service on your development machine. Follow [this guide](https://www.mongodb.com/docs/manual/installation/) for details.

---

Once MongoDB is running, create a directory and initialize it with `bun init`.

```sh terminal icon="terminal"
mkdir mongoose-app
cd mongoose-app
bun init
```

---

Then add Mongoose as a dependency.

```sh terminal icon="terminal"
bun add mongoose
```

---

In `schema.ts` we'll declare and export an `Animal` model.

```ts schema.ts icon="/icons/typescript.svg"
import * as mongoose from "mongoose";

const animalSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    sound: { type: String, required: true },
  },
  {
    methods: {
      speak() {
        console.log(`${this.sound}!`);
      },
    },
  },
);

export type Animal = mongoose.InferSchemaType<typeof animalSchema>;
export const Animal = mongoose.model("Animal", animalSchema);
```

---

Now from `index.ts` we can import `Animal`, connect to MongoDB, and add some data to our database.

```ts index.ts icon="/icons/typescript.svg"
import * as mongoose from "mongoose";
import { Animal } from "./schema";

// connect to database
await mongoose.connect("mongodb://127.0.0.1:27017/mongoose-app");

// create new Animal
const cow = new Animal({
  title: "Cow",
  sound: "Moo",
});
await cow.save(); // saves to the database

// read all Animals
const animals = await Animal.find();
animals[0].speak(); // logs "Moo!"

// disconnect
await mongoose.disconnect();
```

---

Let's run this with `bun run`.

```bash terminal icon="terminal"
bun run index.ts
```

```txt
Moo!
```

---

This is an introduction to using Mongoose with TypeScript and Bun. As you build your application, refer to the official [MongoDB](https://www.mongodb.com/docs) and [Mongoose](https://mongoosejs.com/docs/) sites for complete documentation.
