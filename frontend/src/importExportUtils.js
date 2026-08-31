// xlsx is heavy (~430 kB) and only needed for the admin import/export flows,
// so it is loaded on demand rather than in the main bundle.
let xlsxPromise = null
function loadXLSX() {
  if (!xlsxPromise) xlsxPromise = import('xlsx')
  return xlsxPromise
}

export function exportToJson(data, filename) {
  const jsonStr = JSON.stringify(data, null, 2)
  const blob = new Blob([jsonStr], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.json') ? filename : `${filename}.json`
  a.click()
  URL.revokeObjectURL(url)
}

export async function exportQuizToExcel(items, filename) {
  const XLSX = await loadXLSX()
  // Map items to excel rows
  const rows = items.map(item => {
    const row = {
      Question: item.question,
      Points: item.points || 1,
      'Correct Option (0-indexed)': item.correctOption ?? '',
      Tags: (item.tags || []).join(', ')
    }
    // Add options
    if (item.options && Array.isArray(item.options)) {
      item.options.forEach((opt, idx) => {
        row[`Option ${idx + 1}`] = opt
      })
    }
    return row
  })

  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Quiz')
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`)
}

/** FileReader fallback for Blob.text() — needed on iOS Safari < 14. */
function readAsText(file) {
  if (file.text) return file.text()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsText(file)
  })
}

/** FileReader fallback for Blob.arrayBuffer() — needed on iOS Safari < 14. */
function readAsArrayBuffer(file) {
  if (file.arrayBuffer) return file.arrayBuffer()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })
}

export async function importFromFile(file) {
  if (file.name.endsWith('.json')) {
    const text = await readAsText(file)
    return JSON.parse(text)
  } else if (file.name.match(/\.(xlsx|xls|csv)$/)) {
    const data = await readAsArrayBuffer(file)
    const XLSX = await loadXLSX()
    const wb = XLSX.read(data)
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(ws)
    
    return rows.map(row => {
      // Find all option columns
      const options = []
      let optIdx = 1
      while (row[`Option ${optIdx}`] !== undefined) {
        options.push(String(row[`Option ${optIdx}`]))
        optIdx++
      }
      
      let correctOption = parseInt(row['Correct Option (0-indexed)'], 10)
      if (isNaN(correctOption)) correctOption = null
      
      let points = parseInt(row['Points'], 10)
      if (isNaN(points)) points = 1

      let tags = []
      if (row['Tags']) {
        tags = String(row['Tags']).split(',').map(s => s.trim()).filter(Boolean)
      }

      return {
        question: row['Question'] || '',
        options,
        correctOption,
        points,
        tags
      }
    }).filter(item => item.question && item.options.length > 0)
  } else {
    throw new Error('Unsupported file format')
  }
}

export function downloadSampleJson() {
  const sampleData = [
    {
      question: 'Câu hỏi mẫu 1 (Thủ đô của Việt Nam là gì?)',
      options: ['Hà Nội', 'TP. Hồ Chí Minh', 'Đà Nẵng', 'Hải Phòng'],
      correctOption: 0,
      points: 1,
      tags: ['dia-ly', 'de']
    },
    {
      question: 'Câu hỏi mẫu 2 (1 + 1 bằng mấy?)',
      options: ['1', '2', '3'],
      correctOption: 1,
      points: 2,
      tags: ['toan-hoc']
    }
  ]
  exportToJson(sampleData, 'mau_nhap_cau_hoi.json')
}

export async function downloadSampleExcel() {
  const sampleData = [
    {
      question: 'Câu hỏi mẫu 1 (Thủ đô của Việt Nam là gì?)',
      options: ['Hà Nội', 'TP. Hồ Chí Minh', 'Đà Nẵng', 'Hải Phòng'],
      correctOption: 0,
      points: 1,
      tags: ['dia-ly', 'de']
    },
    {
      question: 'Câu hỏi mẫu 2 (1 + 1 bằng mấy?)',
      options: ['1', '2', '3'],
      correctOption: 1,
      points: 2,
      tags: ['toan-hoc']
    }
  ]
  await exportQuizToExcel(sampleData, 'mau_nhap_cau_hoi.xlsx')
}

