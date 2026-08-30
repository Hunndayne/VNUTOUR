import * as XLSX from 'xlsx'

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

export function exportQuizToExcel(items, filename) {
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

export async function importFromFile(file) {
  if (file.name.endsWith('.json')) {
    const text = await file.text()
    return JSON.parse(text)
  } else if (file.name.match(/\.(xlsx|xls|csv)$/)) {
    const data = await file.arrayBuffer()
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

export function downloadSampleExcel() {
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
  exportQuizToExcel(sampleData, 'mau_nhap_cau_hoi.xlsx')
}

