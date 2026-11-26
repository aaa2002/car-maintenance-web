// Romanian counties with the ISO 3166-2 codes e-Factura expects (CIUS-RO). Bucharest addresses use a sector as the city.
export const COUNTIES: [code: string, name: string][] = [
  ['RO-AB', 'Alba'], ['RO-AR', 'Arad'], ['RO-AG', 'Argeș'], ['RO-BC', 'Bacău'], ['RO-BH', 'Bihor'], ['RO-BN', 'Bistrița-Năsăud'],
  ['RO-BT', 'Botoșani'], ['RO-BV', 'Brașov'], ['RO-BR', 'Brăila'], ['RO-B', 'București'], ['RO-BZ', 'Buzău'], ['RO-CS', 'Caraș-Severin'],
  ['RO-CL', 'Călărași'], ['RO-CJ', 'Cluj'], ['RO-CT', 'Constanța'], ['RO-CV', 'Covasna'], ['RO-DB', 'Dâmbovița'], ['RO-DJ', 'Dolj'],
  ['RO-GL', 'Galați'], ['RO-GR', 'Giurgiu'], ['RO-GJ', 'Gorj'], ['RO-HR', 'Harghita'], ['RO-HD', 'Hunedoara'], ['RO-IL', 'Ialomița'],
  ['RO-IS', 'Iași'], ['RO-IF', 'Ilfov'], ['RO-MM', 'Maramureș'], ['RO-MH', 'Mehedinți'], ['RO-MS', 'Mureș'], ['RO-NT', 'Neamț'],
  ['RO-OT', 'Olt'], ['RO-PH', 'Prahova'], ['RO-SM', 'Satu Mare'], ['RO-SJ', 'Sălaj'], ['RO-SB', 'Sibiu'], ['RO-SV', 'Suceava'],
  ['RO-TR', 'Teleorman'], ['RO-TM', 'Timiș'], ['RO-TL', 'Tulcea'], ['RO-VS', 'Vaslui'], ['RO-VL', 'Vâlcea'], ['RO-VN', 'Vrancea'],
];
export const BUCHAREST_SECTORS = ['SECTOR1', 'SECTOR2', 'SECTOR3', 'SECTOR4', 'SECTOR5', 'SECTOR6'];
export const countyName = (code: string | null | undefined) => COUNTIES.find(([value]) => value === code)?.[1] ?? code ?? '';

/** IBAN checksum (ISO 13616, mod 97). Spaces are ignored. */
export function validIban(value: string) {
  const iban = value.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  if (iban.startsWith('RO') && iban.length !== 24) return false;
  const digits = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (letter) => String(letter.charCodeAt(0) - 55));
  let remainder = 0;
  for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  return remainder === 1;
}

/** Romanian company tax id (CUI/CIF) checksum; accepts an optional "RO" prefix. */
export function validCui(value: string) {
  const cui = value.replace(/^RO/i, '').trim();
  if (!/^\d{2,10}$/.test(cui)) return false;
  const digits = cui.split('').map(Number);
  const control = digits.pop()!;
  const key = [7, 5, 3, 2, 1, 7, 5, 3, 2].slice(9 - digits.length);
  const sum = digits.reduce((total, digit, index) => total + digit * key[index], 0);
  return ((sum * 10) % 11) % 10 === control;
}

/** Personal numeric code (CNP) checksum, for drivers invoiced as individuals. */
export function validCnp(value: string) {
  if (!/^\d{13}$/.test(value)) return false;
  const key = '279146358279';
  const sum = key.split('').reduce((total, weight, index) => total + Number(weight) * Number(value[index]), 0);
  const control = sum % 11 === 10 ? 1 : sum % 11;
  return control === Number(value[12]);
}
