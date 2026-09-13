const fs = require('fs')
const path = require('path')

const srcDir = path.join(__dirname, 'src')

function walkSync(dir, filelist = []) {
  const files = fs.readdirSync(dir)
  for (const file of files) {
    const filepath = path.join(dir, file)
    if (fs.statSync(filepath).isDirectory()) {
      walkSync(filepath, filelist)
    } else if (filepath.endsWith('.jsx') || filepath.endsWith('.js')) {
      filelist.push(filepath)
    }
  }
  return filelist
}

const files = walkSync(srcDir)
let changedFiles = 0

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8')
  let changed = false

  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]
    
    // Check if line has 'flex' and 'gap-'
    if (line.includes('flex') && line.includes('gap-') && !line.includes('grid')) {
      // Determine if it's flex-col
      const isCol = line.includes('flex-col')
      
      // Replace gap-X with space-X
      const newLine = line.replace(/\bgap-([a-zA-Z0-9.-]+)\b/g, (match, p1) => {
        if (isCol) return `space-y-${p1}`
        return `space-x-${p1}`
      })
      
      // Replace gap-x-X and gap-y-X
      const newLine2 = newLine
        .replace(/\bgap-x-([a-zA-Z0-9.-]+)\b/g, 'space-x-$1')
        .replace(/\bgap-y-([a-zA-Z0-9.-]+)\b/g, 'space-y-$1')
        
      if (line !== newLine2) {
        lines[i] = newLine2
        changed = true
      }
    }
  }

  if (changed) {
    fs.writeFileSync(file, lines.join('\n'))
    changedFiles++
    console.log('Fixed:', path.basename(file))
  }
}

console.log(`Done. Changed ${changedFiles} files.`)
