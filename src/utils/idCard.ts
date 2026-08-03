export type IdCardGender = 'MALE' | 'FEMALE'

export type IdCardResult = {
  isValid: boolean
  birthDate: Date | null
  gender: IdCardGender | null
}

const WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
const CHECK_CODES = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2']

export function parseIdCard(raw: string): IdCardResult {
  const idCard = String(raw || '').trim().toUpperCase()
  if (!/^\d{17}[\dX]$/.test(idCard)) return { isValid: false, birthDate: null, gender: null }

  const expected = CHECK_CODES[idCard.slice(0, 17).split('').reduce((sum, digit, index) => sum + Number(digit) * WEIGHTS[index], 0) % 11]
  if (expected !== idCard[17]) return { isValid: false, birthDate: null, gender: null }

  const birth = idCard.slice(6, 14)
  const year = Number(birth.slice(0, 4))
  const month = Number(birth.slice(4, 6))
  const day = Number(birth.slice(6, 8))
  const birthDate = new Date(Date.UTC(year, month - 1, day))
  if (birthDate.getUTCFullYear() !== year || birthDate.getUTCMonth() !== month - 1 || birthDate.getUTCDate() !== day || birthDate > new Date()) {
    return { isValid: false, birthDate: null, gender: null }
  }

  return { isValid: true, birthDate, gender: Number(idCard[16]) % 2 ? 'MALE' : 'FEMALE' }
}

