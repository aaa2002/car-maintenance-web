const modelsByMake: Record<string, string[]> = {
  Audi: ['A1', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'Q2', 'Q3', 'Q5', 'Q7', 'Q8', 'E-Tron'],
  BMW: ['1 Series', '2 Series', '3 Series', '4 Series', '5 Series', '7 Series', 'X1', 'X3', 'X5', 'X6', 'X7', 'i3', 'i4', 'iX'],
  Dacia: ['Duster', 'Jogger', 'Logan', 'Logan MCV', 'Sandero', 'Sandero Stepway', 'Spring'],
  Ford: ['EcoSport', 'Fiesta', 'Focus', 'Kuga', 'Mondeo', 'Mustang', 'Puma', 'Ranger', 'Transit'],
  Honda: ['Accord', 'Civic', 'CR-V', 'HR-V', 'Jazz'],
  Hyundai: ['i10', 'i20', 'i30', 'Ioniq 5', 'Kona', 'Santa Fe', 'Tucson'],
  Kia: ['Ceed', 'EV6', 'Niro', 'Picanto', 'Rio', 'Sorento', 'Sportage', 'Stonic'],
  'Mercedes-Benz': ['A-Class', 'B-Class', 'C-Class', 'CLA', 'E-Class', 'GLA', 'GLC', 'GLE', 'S-Class', 'Vito'],
  Opel: ['Astra', 'Corsa', 'Insignia', 'Mokka', 'Vectra', 'Vivaro', 'Zafira'],
  Peugeot: ['206', '207', '208', '307', '308', '408', '508', '2008', '3008', '5008'],
  Renault: ['Captur', 'Clio', 'Kadjar', 'Megane', 'Scenic', 'Talisman', 'Trafic'],
  Skoda: ['Fabia', 'Kamiq', 'Karoq', 'Kodiaq', 'Octavia', 'Superb'],
  Tesla: ['Model 3', 'Model S', 'Model X', 'Model Y'],
  Toyota: ['Auris', 'Avensis', 'Aygo', 'C-HR', 'Camry', 'Corolla', 'Land Cruiser', 'Prius', 'RAV4', 'Yaris'],
  Volkswagen: ['Caddy', 'Golf', 'ID.3', 'ID.4', 'Jetta', 'Passat', 'Polo', 'T-Roc', 'Tiguan', 'Touareg', 'Touran'],
  Volvo: ['S60', 'S90', 'V40', 'V60', 'V90', 'XC40', 'XC60', 'XC90'],
};

export const carMakes = Object.keys(modelsByMake);
export function modelsForMake(make: string) {
  const key = carMakes.find((value) => value.toLowerCase() === make.trim().toLowerCase());
  return key ? modelsByMake[key] : [];
}
