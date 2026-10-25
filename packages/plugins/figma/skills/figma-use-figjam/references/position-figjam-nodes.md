# FigJam Node Positioning Tutorial

> Part of the [figma-use-figjam skill](../SKILL.md). Positioning, sizing, and reparenting nodes on the canvas.

Use this skill when working with positioning, sizing, and reparenting nodes.

## Basics of how nodes are positioned

Nodes may be positioned by setting their `x` and `y` properties. Nodes are positioned with respect to their parent.

```javascript
// Position (relative to parent)
node.x = 100
node.y = 200
```

## Positioning Nodes Relative to Existing Nodes

It's important to remember that `node.x` and `node.y` are relative to the node's parent, not the page. For example: a node inside a section has coordinates relative to that section's origin.

When creating or placing a node relative to an existing node:

1. **Find the parent**: Locate the parent of the existing node.
2. **Add new node to parent**: Call `parent.appendChild()` to add the new node to the parent.
3. **Position within parent**: Position the new node within the parent. The x / y coordinates of the new node will be with respect to the top-left corner of the parent.
4. **Ensure parent sections encompass their children**: If the parent is a section:
   a. Resize the section to encompass the new node
   b. (see [create-section](create-section.md) — "Resizing an Existing Section" for more info)

Example helper function:

```javascript
// existingNodeId (string): the node id you are positioning relative to
// nodeToPosition: the node you are trying to position relative to the existing node
async function placeNodeRelativeToOtherNode(existingNodeId, nodeToPosition) {

  // 1: find the parent of existing node
  const existingNode = await figma.getNodeByIdAsync(existingNodeId);
  const parent = existingNode.parent

  // 2: add the node to the parent
  parent.appendChild(nodeToPosition)

  // 3: position the node w.r.t the top-left corner of the parent
  // here, we chose to place it to the right of the existing node
  nodeToPosition.x = existingNode.x + existingNode.width + 40;
  nodeToPosition.y = existingNode.y;

  // 4: if the parent is a section: resize the section if needed
  if (parent.type === 'SECTION') {
    // ... resize if needed, (see [create-section](create-section.md) — "Resizing an Existing Section" for more info)
  }
}
```

## Adding Nodes to a Section

Use `appendChild` to move existing nodes into a section.

**CRITICAL**: when you call `appendChild`, the node's x/y coordinates become relative to the **section's local coordinate space**, where (0,0) is the top-left corner of the section — NOT absolute board coordinates. Always call `appendChild` **first**, then set the node's position using section-local coordinates.

**IMPORTANT:** After adding nodes to a section, you MUST check that the section encompasses its children. Refer to the `Resizing an Existing Section` code snippet for reference. This is _crucial_ for a high-quality output.

Steps:

1. **Add new node to parent**: Call `parent.appendChild()` to add the new node to the parent.
2. **Position within parent**: Position the new node within the parent. The x / y coordinates of the new node will be with respect to the TL of the parent.
3. **Clean up any layout consequences**: If the parent is a section:
   a. Resize the section to encompass the new node
   b. (see [create-section](create-section.md) — "Resizing an Existing Section" for more info)

Example helper function:

```javascript
function addNodeToSection(node, section) {
  // Ensure this is a section
  if (section.type !== 'SECTION') {
    console.log('The node provided is not a section')
    return
  }

  // Append FIRST, then position using section-local coordinates
  section.appendChild(node)
  node.x = 32
  node.y = 32
  console.log(`Moved ${node.name} into ${section.name}`)

  // ... resize section if needed, (see [create-section](create-section.md) — "Resizing an Existing Section" for more info)
}
```
