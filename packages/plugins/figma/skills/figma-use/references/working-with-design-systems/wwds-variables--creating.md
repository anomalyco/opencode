# Working with design systems: Creating Variables

When creating Figma variables, you need to start by understanding the state of the source data.

If the user is asking you to create variables based on values, they likely want you to indicate the structure. Whether or not you use semantic aliasing primitive will be based on the inputs you are given about the source data.

If you are given code inputs (JSON, CSS, etc) your goal should be to reflect the existing patterns as closely as possible, but also embrace the design context as distinct from code. For example, casing is less important since you have code syntax that can directly represent the code form. Feel free to take a sentence or capitalized case approach for better readability in Figma.

It is important to understand the underlying structure before you create anything. If there is an implied aliased setup, you want to get that right. You may also need to anticipate modes to know how to split things up. Sizes and Colors likely have different mode requirements in complex systems, so you want to consider that as you create the structure.

If someone asks you to just make a decision based on best practices, that answer will be relative to the complexity of the environment. A simple theme is great best practice for simple needs. Similarly, a complex extended collection setup for someone on an enterprise plan might also be best practice as well.

Keep in mind that systems might also require you to handle text and effect styles for some of the things specified in token libraries.
