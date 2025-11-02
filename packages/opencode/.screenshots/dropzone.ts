#!/usr/bin/env bun
import { Tui, Box, Text } from "@opentui/core"
import fs from "fs"
import path from "path"

const SCREENSHOTS_DIR = path.join(process.cwd(), ".screenshots")

const tui = new Tui({
  title: "Screenshot Dropzone",
})

let status = "Drop a file here..."
let lastFile = ""

tui.root.append(
  Box.create({
    width: "100%",
    height: "100%",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    gap: 2,
  }).append(
    Text.create({
      content: "📸 Screenshot Dropzone",
      bold: true,
      fontSize: 2,
    }),
    Text.create({
      content: "Drag a file into this terminal window",
      color: { r: 150, g: 150, b: 150, a: 255 },
    }),
    Box.create({
      width: 60,
      height: 10,
      border: "rounded",
      borderColor: { r: 102, g: 126, b: 234, a: 255 },
      justifyContent: "center",
      alignItems: "center",
      marginTop: 2,
    }).append(
      Text.create({
        content: status,
        color: { r: 102, g: 126, b: 234, a: 255 },
      })
    ),
    lastFile ? Box.create({
      marginTop: 2,
      flexDirection: "column",
      gap: 1,
    }).append(
      Text.create({
        content: `✅ Saved: ${lastFile}`,
        color: { r: 40, g: 167, b: 69, a: 255 },
      }),
      Text.create({
        content: `💬 Tell AI: check .screenshots/${lastFile}`,
        color: { r: 102, g: 126, b: 234, a: 255 },
      })
    ) : null,
    Box.create({
      marginTop: 2,
    }).append(
      Text.create({
        content: "Press q to quit",
        color: { r: 150, g: 150, b: 150, a: 255 },
      })
    )
  )
)

// Listen for stdin (this will receive the file path when dragged)
process.stdin.setRawMode(true)
process.stdin.on('data', (data) => {
  const key = data.toString()
  
  if (key === 'q' || key === '\u0003') {
    tui.stop()
    process.exit(0)
  }
  
  // Check if it's a file path (drag and drop typically includes full path)
  if (key.includes('/') && !key.includes('\n')) {
    handleFileDrop(key.trim())
  }
})

function handleFileDrop(filePath: string) {
  try {
    // Clean the path (remove quotes, etc)
    filePath = filePath.replace(/['"]/g, '').trim()
    
    if (!fs.existsSync(filePath)) {
      status = `❌ File not found: ${filePath}`
      return
    }
    
    const ext = path.extname(filePath)
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)
    const newFilename = `screenshot-${timestamp}${ext}`
    const destPath = path.join(SCREENSHOTS_DIR, newFilename)
    
    // Copy file
    fs.copyFileSync(filePath, destPath)
    
    status = "✅ File saved!"
    lastFile = newFilename
    
    console.log(`\n✅ Saved: ${newFilename}`)
    console.log(`📁 Location: .screenshots/${newFilename}`)
    console.log(`💬 Tell AI: check .screenshots/${newFilename}\n`)
  } catch (err) {
    status = `❌ Error: ${err.message}`
  }
}

tui.run()
