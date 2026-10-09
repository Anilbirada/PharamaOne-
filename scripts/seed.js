/**
 * PharmaOne — 60-Day Synthetic Pharmacy Data Seeder, Verifier, and Cleanup Tool
 *
 * Supports commands:
 *   node scripts/seed.js seed [--target=<path>] [--days=60]
 *   node scripts/seed.js verify [--target=<path>] [--days=60]
 *   node scripts/seed.js cleanup [--target=<path>]
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { buildSalesAnalytics, buildSalesReport } = require('../analytics');

const SEED_TAG = 'DEMO_SEED_60D';
const STORE_NAME = 'PharmaOne Demo Pharmacy';
const CURRENCY = 'INR';
const TIMEZONE = 'Asia/Kolkata';
const DEMO_BASELINE_MEDICINES = [
  {
    name: 'Dolo 650',
    generic: 'Paracetamol',
    brand: 'Micro Labs',
    batch: 'DL650-A1',
    expiry: '2027-12-31',
    price: 30,
    cost: 22,
    stock: 50,
    minStock: 10,
    barcode: '890123456001'
  },
  {
    name: 'Vitamin C 500',
    generic: 'Ascorbic Acid',
    brand: 'HealthPlus',
    batch: 'VC500-B2',
    expiry: '2027-08-31',
    price: 80,
    cost: 55,
    stock: 8,
    minStock: 10,
    barcode: '890123456002'
  },
  {
    name: 'Cetirizine 10',
    generic: 'Cetirizine',
    brand: 'AllerCare',
    batch: 'CT10-C3',
    expiry: '2028-02-28',
    price: 25,
    cost: 12,
    stock: 35,
    minStock: 8,
    barcode: '890123456003'
  }
];

// Pseudo-Random Number Generator with fixed seed for determinism (xoshiro128ss / Mulberry32)
function createRng(seed = 123456789) {
  let s = seed >>> 0;
  return function() {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = createRng(428921);

function randomInt(min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function randomChoice(arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function round(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

// Medicine catalogue template with realistic therapeutic classes, generic names, brands, dosages
const MEDICINE_CATALOGUE = [
  // Antibiotics & Anti-infectives
  { name: 'Augmentin 625 Duo Tablet', generic: 'Amoxicillin + Clavulanic Acid', brand: 'GSK', price: 210, cost: 155, minStock: 25 },
  { name: 'Azithral 500 Tablet', generic: 'Azithromycin', brand: 'Alembic', price: 130, cost: 95, minStock: 20 },
  { name: 'Ciplox 500 Tablet', generic: 'Ciprofloxacin', brand: 'Cipla', price: 45, cost: 30, minStock: 15 },
  { name: 'Moxikind-CV 625', generic: 'Amoxicillin + Clavulanic Acid', brand: 'Mankind', price: 180, cost: 130, minStock: 20 },
  { name: 'Oflox 200 Tablet', generic: 'Ofloxacin', brand: 'Cipla', price: 68, cost: 48, minStock: 15 },
  { name: 'Cefix 200 Tablet', generic: 'Cefixime', brand: 'Cipla', price: 115, cost: 82, minStock: 20 },
  { name: 'Taxim-O 200 Tablet', generic: 'Cefixime', brand: 'Alkem', price: 120, cost: 85, minStock: 20 },
  { name: 'Clavam 625 Tablet', generic: 'Amoxicillin + Clavulanic Acid', brand: 'Alkem', price: 195, cost: 142, minStock: 20 },
  { name: 'Metrogyl 400 Tablet', generic: 'Metronidazole', brand: 'J.B. Chemicals', price: 25, cost: 15, minStock: 30 },
  { name: 'Monocef-O 200', generic: 'Cefpodoxime Proxetil', brand: 'Aristo', price: 175, cost: 125, minStock: 15 },
  { name: 'Norflox 400 Tablet', generic: 'Norfloxacin', brand: 'Cipla', price: 78, cost: 52, minStock: 15 },
  { name: 'Doxy-1 L-DR Forte', generic: 'Doxycycline + Lactic Acid Bacillus', brand: 'USV', price: 110, cost: 75, minStock: 15 },

  // Analgesics, Antipyretics & NSAIDs
  { name: 'Dolo 650 Tablet', generic: 'Paracetamol', brand: 'Micro Labs', price: 32, cost: 22, minStock: 50 },
  { name: 'Calpol 500 Tablet', generic: 'Paracetamol', brand: 'GSK', price: 20, cost: 14, minStock: 40 },
  { name: 'Combiflam Tablet', generic: 'Ibuprofen + Paracetamol', brand: 'Sanofi', price: 42, cost: 28, minStock: 40 },
  { name: 'Zerodol-SP Tablet', generic: 'Aceclofenac + Paracetamol + Serratiopeptidase', brand: 'Ipca', price: 125, cost: 88, minStock: 30 },
  { name: 'Voveran 50 GE Tablet', generic: 'Diclofenac Sodium', brand: 'Novartis', price: 55, cost: 38, minStock: 25 },
  { name: 'Meftal-Spas Tablet', generic: 'Mefenamic Acid + Dicyclomine', brand: 'Blue Cross', price: 50, cost: 34, minStock: 25 },
  { name: 'Flexon Tablet', generic: 'Ibuprofen + Paracetamol', brand: 'Aristo', price: 35, cost: 23, minStock: 30 },
  { name: 'Ultracet Tablet', generic: 'Tramadol + Paracetamol', brand: 'Janssen', price: 220, cost: 165, minStock: 10 },
  { name: 'Naprosyn 500 Tablet', generic: 'Naproxen', brand: 'RPG Life Sciences', price: 72, cost: 50, minStock: 15 },
  { name: 'Enzoflam Tablet', generic: 'Diclofenac + Paracetamol + Serratiopeptidase', brand: 'Alkem', price: 140, cost: 98, minStock: 20 },

  // Gastrointestinal & Antacids
  { name: 'Pan 40 Tablet', generic: 'Pantoprazole', brand: 'Alkem', price: 155, cost: 110, minStock: 35 },
  { name: 'Pan-D Capsule', generic: 'Pantoprazole + Domperidone', brand: 'Alkem', price: 199, cost: 140, minStock: 35 },
  { name: 'Omez 20 Capsule', generic: 'Omeprazole', brand: 'Dr. Reddy\'s', price: 65, cost: 44, minStock: 30 },
  { name: 'Omez-D Capsule', generic: 'Omeprazole + Domperidone', brand: 'Dr. Reddy\'s', price: 95, cost: 68, minStock: 25 },
  { name: 'Rantac 150 Tablet', generic: 'Ranitidine', brand: 'JB Chemicals', price: 40, cost: 26, minStock: 30 },
  { name: 'Gelusil MPS Liquid 200ml', generic: 'Aluminium Hydroxide + Magnesium + Simethicone', brand: 'Pfizer', price: 135, cost: 95, minStock: 20 },
  { name: 'Digene Gel Mint 200ml', generic: 'Magnesium Hydroxide + Simethicone', brand: 'Abbott', price: 145, cost: 102, minStock: 20 },
  { name: 'Rabeprazole 20 (Rablet)', generic: 'Rabeprazole', brand: 'Lupin', price: 110, cost: 76, minStock: 20 },
  { name: 'Rabekind-DSR Capsule', generic: 'Rabeprazole + Domperidone SR', brand: 'Mankind', price: 165, cost: 115, minStock: 25 },
  { name: 'Cremaffin Syrup 225ml', generic: 'Liquid Paraffin + Milk of Magnesia', brand: 'Abbott', price: 280, cost: 205, minStock: 15 },
  { name: 'Duphalac Oral Solution 150ml', generic: 'Lactulose', brand: 'Abbott', price: 295, cost: 215, minStock: 15 },
  { name: 'Econorm Sachet', generic: 'Saccharomyces boulardii', brand: 'Dr. Reddy\'s', price: 55, cost: 38, minStock: 25 },
  { name: 'Eldoper 2mg Capsule', generic: 'Loperamide', brand: 'Micro Labs', price: 28, cost: 18, minStock: 25 },

  // Anti-Allergic, Respiratory & Cough
  { name: 'Allegra 120mg Tablet', generic: 'Fexofenadine', brand: 'Sanofi', price: 215, cost: 155, minStock: 20 },
  { name: 'Cetzine 10mg Tablet', generic: 'Cetirizine', brand: 'GSK', price: 22, cost: 14, minStock: 40 },
  { name: 'Levocet 5mg Tablet', generic: 'Levocetirizine', brand: 'Hetero', price: 58, cost: 38, minStock: 25 },
  { name: 'Montair-LC Tablet', generic: 'Montelukast + Levocetirizine', brand: 'Cipla', price: 310, cost: 220, minStock: 25 },
  { name: 'Montek-LC Tablet', generic: 'Montelukast + Levocetirizine', brand: 'Sun Pharma', price: 305, cost: 218, minStock: 20 },
  { name: 'Ascoril D Plus Syrup 100ml', generic: 'Dextromethorphan + Phenylephrine + Chlorpheniramine', brand: 'Glenmark', price: 128, cost: 90, minStock: 25 },
  { name: 'Ascoril LS Syrup 100ml', generic: 'Levosalbutamol + Ambroxol + Guaiphenesin', brand: 'Glenmark', price: 118, cost: 82, minStock: 25 },
  { name: 'Benadryl Cough Syrup 100ml', generic: 'Diphenhydramine + Ammonium Chloride', brand: 'J&J', price: 130, cost: 92, minStock: 20 },
  { name: 'Alex Cough Syrup 100ml', generic: 'Dextromethorphan + Chlorpheniramine', brand: 'Glenmark', price: 125, cost: 88, minStock: 20 },
  { name: 'Otrivin Adult Nasal Spray 10ml', generic: 'Xylometazoline', brand: 'GSK', price: 112, cost: 80, minStock: 25 },
  { name: 'Asthalin 100mcg Inhaler', generic: 'Salbutamol', brand: 'Cipla', price: 165, cost: 120, minStock: 15 },
  { name: 'Budecort 200 Inhaler', generic: 'Budesonide', brand: 'Cipla', price: 385, cost: 280, minStock: 12 },
  { name: 'Foracort 200 Synchrobreathe', generic: 'Formoterol + Budesonide', brand: 'Cipla', price: 540, cost: 400, minStock: 10 },

  // Cardiovascular & Hypertension
  { name: 'Telma 40 Tablet', generic: 'Telmisartan', brand: 'Glenmark', price: 140, cost: 98, minStock: 30 },
  { name: 'Telma-H Tablet', generic: 'Telmisartan + Hydrochlorothiazide', brand: 'Glenmark', price: 185, cost: 130, minStock: 20 },
  { name: 'Telmikind 40 Tablet', generic: 'Telmisartan', brand: 'Mankind', price: 75, cost: 50, minStock: 25 },
  { name: 'Amlong 5 Tablet', generic: 'Amlodipine', brand: 'Micro Labs', price: 42, cost: 28, minStock: 30 },
  { name: 'Cilacar 10 Tablet', generic: 'Cilnidipine', brand: 'J.B. Chemicals', price: 112, cost: 78, minStock: 20 },
  { name: 'Concor 5 Tablet', generic: 'Bisoprolol', brand: 'Merck', price: 132, cost: 94, minStock: 15 },
  { name: 'Metolar XR 25', generic: 'Metoprolol Succinate', brand: 'Cipla', price: 82, cost: 58, minStock: 20 },
  { name: 'Atorva 10 Tablet', generic: 'Atorvastatin', brand: 'Zydus Cadila', price: 95, cost: 66, minStock: 25 },
  { name: 'Atorva 20 Tablet', generic: 'Atorvastatin', brand: 'Zydus Cadila', price: 165, cost: 118, minStock: 20 },
  { name: 'Rosuvas 10 Tablet', generic: 'Rosuvastatin', brand: 'Sun Pharma', price: 235, cost: 168, minStock: 20 },
  { name: 'Ecosprin 75 Tablet', generic: 'Aspirin', brand: 'USV', price: 6, cost: 3.5, minStock: 60 },
  { name: 'Ecosprin 150 Tablet', generic: 'Aspirin', brand: 'USV', price: 9, cost: 5.5, minStock: 50 },
  { name: 'Clopilet 75 Tablet', generic: 'Clopidogrel', brand: 'Sun Pharma', price: 145, cost: 102, minStock: 20 },

  // Diabetes & Endocrine
  { name: 'Glycomet 500 SR Tablet', generic: 'Metformin', brand: 'USV', price: 24, cost: 15, minStock: 50 },
  { name: 'Glycomet GP 1 Tablet', generic: 'Glimepiride + Metformin', brand: 'USV', price: 95, cost: 68, minStock: 30 },
  { name: 'Glycomet GP 2 Tablet', generic: 'Glimepiride + Metformin', brand: 'USV', price: 135, cost: 96, minStock: 30 },
  { name: 'Galvus Met 50/500 Tablet', generic: 'Vildagliptin + Metformin', brand: 'Novartis', price: 345, cost: 255, minStock: 15 },
  { name: 'Janumet 50/500 Tablet', generic: 'Sitagliptin + Metformin', brand: 'MSD', price: 460, cost: 345, minStock: 12 },
  { name: 'Jardiance 10mg Tablet', generic: 'Empagliflozin', brand: 'Boehringer Ingelheim', price: 680, cost: 510, minStock: 10 },
  { name: 'Thyronorm 50mcg Tablet', generic: 'Thyroxine Sodium', brand: 'Abbott', price: 160, cost: 115, minStock: 35 },
  { name: 'Thyronorm 100mcg Tablet', generic: 'Thyroxine Sodium', brand: 'Abbott', price: 195, cost: 140, minStock: 35 },
  { name: 'Eltroxin 50mcg Tablet', generic: 'Levothyroxine', brand: 'GSK', price: 155, cost: 110, minStock: 30 },

  // Vitamins, Minerals & Supplements
  { name: 'Becosules Z Capsule', generic: 'B-Complex + Vitamin C + Zinc', brand: 'Pfizer', price: 52, cost: 36, minStock: 40 },
  { name: 'Shelcal 500 Tablet', generic: 'Calcium + Vitamin D3', brand: 'Torrent', price: 132, cost: 92, minStock: 35 },
  { name: 'Shelcal HD Tablet', generic: 'Calcium + Higher Vitamin D3', brand: 'Torrent', price: 155, cost: 110, minStock: 25 },
  { name: 'Limcee 500 Chewable Tablet', generic: 'Vitamin C', brand: 'Abbott', price: 26, cost: 17, minStock: 50 },
  { name: 'Celin 500 Chewable Tablet', generic: 'Vitamin C', brand: 'KOYE', price: 40, cost: 27, minStock: 30 },
  { name: 'Neurobion Forte Tablet', generic: 'Vitamin B1 + B6 + B12', brand: 'P&G Health', price: 42, cost: 29, minStock: 45 },
  { name: 'Supradyn Daily Tablet', generic: 'Multivitamin + Minerals + Trace Elements', brand: 'Bayer', price: 65, cost: 45, minStock: 35 },
  { name: 'Zincovit Tablet', generic: 'Multivitamin + Multimineral with Grape Seed', brand: 'Apex', price: 115, cost: 80, minStock: 40 },
  { name: 'Azee Dry Syrup 30ml', generic: 'Azithromycin', brand: 'Cipla', price: 65, cost: 44, minStock: 15 },
  { name: 'Orofer XT Tablet', generic: 'Ferrous Ascorbate + Folic Acid', brand: 'Emcure', price: 185, cost: 130, minStock: 25 },
  { name: 'Livogen Adult Tonic 200ml', generic: 'Iron + Vitamin B12 + Folic Acid', brand: 'Merck', price: 175, cost: 122, minStock: 15 },
  { name: 'Evion 400 Capsule', generic: 'Vitamin E', brand: 'P&G Health', price: 38, cost: 25, minStock: 45 },
  { name: 'Calcirol 60000 IU Sachet', generic: 'Cholecalciferol', brand: 'Cadila', price: 58, cost: 38, minStock: 30 },
  { name: 'Upwise 60k Capsule', generic: 'Vitamin D3', brand: 'Cipla', price: 125, cost: 85, minStock: 20 },

  // Dermatology, Topicals & First Aid
  { name: 'Betadine 10% Ointment 20g', generic: 'Povidone Iodine', brand: 'Win-Medicare', price: 125, cost: 88, minStock: 20 },
  { name: 'Soframycin Skin Cream 30g', generic: 'Framycetin Sulphate', brand: 'Sanofi', price: 68, cost: 46, minStock: 25 },
  { name: 'Candid Powder 100g', generic: 'Clotrimazole Dusting Powder', brand: 'Glenmark', price: 165, cost: 118, minStock: 20 },
  { name: 'Volini Pain Relief Gel 30g', generic: 'Diclofenac Diethylamine + Linseed Oil', brand: 'Sun Pharma', price: 145, cost: 102, minStock: 25 },
  { name: 'Moov Pain Relief Cream 50g', generic: 'Wintergreen Oil + Mint Extracts', brand: 'Reckitt', price: 190, cost: 135, minStock: 20 },
  { name: 'Dettol Antiseptic Liquid 250ml', generic: 'Chloroxylenol', brand: 'Reckitt', price: 160, cost: 120, minStock: 25 },
  { name: 'Savlon Antiseptic Liquid 200ml', generic: 'Chlorhexidine Gluconate + Cetrimide', brand: 'ITC', price: 110, cost: 82, minStock: 20 },
  { name: 'Burnol Cream 20g', generic: 'Aminacrine + Cetrimide', brand: 'Dr. Morepen', price: 85, cost: 58, minStock: 15 },
  { name: 'Hansaplast Regular Bandage (10s)', generic: 'Medicated Plaster', brand: 'Beiersdorf', price: 35, cost: 22, minStock: 30 },
  { name: 'Cotton Roll Absorbent 100g', generic: 'Absorbent Cotton Wool', brand: 'Surgicals', price: 75, cost: 48, minStock: 20 },

  // Eye, Ear & Dental
  { name: 'Ciplox Eye/Ear Drops 10ml', generic: 'Ciprofloxacin', brand: 'Cipla', price: 22, cost: 14, minStock: 30 },
  { name: 'Refresh Tears Eye Drops 10ml', generic: 'Carboxymethylcellulose Sodium', brand: 'Allergan', price: 155, cost: 112, minStock: 20 },
  { name: 'Otorex Ear Drops 10ml', generic: 'Chlorbutol + Paradichlorobenzene + Benzocaine', brand: 'Mankind', price: 72, cost: 48, minStock: 15 },
  { name: 'Sensodyne Rapid Relief Toothpaste 80g', generic: 'Potassium Nitrate + Sodium Fluoride', brand: 'GSK', price: 210, cost: 155, minStock: 15 },
  { name: 'Clohex ADS Mouthwash 200ml', generic: 'Chlorhexidine Gluconate', brand: 'Dr. Reddy\'s', price: 160, cost: 115, minStock: 15 },

  // Miscellaneous, Pediatric & General Care
  { name: 'Electral Sachet 21.8g', generic: 'Oral Rehydration Salts WHO Formula', brand: 'FDC', price: 24, cost: 16, minStock: 50 },
  { name: 'Crocin 120 Syrup 60ml', generic: 'Paracetamol Paediatric', brand: 'GSK', price: 45, cost: 30, minStock: 20 },
  { name: 'Maxtra Oral Drops 15ml', generic: 'Phenylephrine + Chlorpheniramine', brand: 'Zuventus', price: 88, cost: 60, minStock: 15 },
  { name: 'Dulcoflex 5mg Tablet', generic: 'Bisacodyl', brand: 'Boehringer Ingelheim', price: 15, cost: 9, minStock: 30 },
  { name: 'Pudina Hara Pearls (10s)', generic: 'Pudina Satva (Mentha Oil)', brand: 'Dabur', price: 30, cost: 19, minStock: 35 },
  { name: 'Hajmola Regular (120 Tablets)', generic: 'Ayurvedic Digestive Tablets', brand: 'Dabur', price: 70, cost: 48, minStock: 25 },
  { name: 'Strepsils Orange Lozenges (8s)', generic: 'Dichlorobenzyl Alcohol + Amylmetacresol', brand: 'Reckitt', price: 40, cost: 26, minStock: 40 },
  { name: 'Vicks VapoRub 25ml', generic: 'Menthol + Camphor + Eucalyptus Oil', brand: 'P&G', price: 95, cost: 68, minStock: 30 },
  { name: 'Revital H Daily Health Capsule (30s)', generic: 'Ginseng + Vitamins + Minerals', brand: 'Sun Pharma', price: 340, cost: 245, minStock: 15 },
  { name: 'Ensure Vanilla Nutrition Powder 400g', generic: 'Balanced Nutritional Supplement', brand: 'Abbott', price: 730, cost: 560, minStock: 10 }
];

const SUPPLIERS_LIST = [
  { name: 'MedPlus Pharma Distributors', contact: 'Ramesh Sharma', mobile: '9845012345', email: 'orders@medplusdist.in', gst: '29ABCDE1234F1Z5', licence: 'DL-KA-BNG-2021-9988', paymentTerms: 'Net 30' },
  { name: 'Apollo Health Distribution Ltd', contact: 'Sunita Rao', mobile: '9845023456', email: 'supply@apollodist.com', gst: '29BCDEF2345G2Z6', licence: 'DL-KA-BNG-2020-7766', paymentTerms: 'Net 21' },
  { name: 'Karnataka Drug Agency', contact: 'Venkatesh Murthy', mobile: '9845034567', email: 'sales@karnatakadrugs.in', gst: '29CDEFG3456H3Z7', licence: 'DL-KA-BNG-2019-5544', paymentTerms: 'Net 15' },
  { name: 'Metro Surgicals & Pharma Logistics', contact: 'Praveen Kumar', mobile: '9845045678', email: 'metrodist@logisticspharma.com', gst: '29DEFGHI4567I4Z8', licence: 'DL-KA-BNG-2022-3322', paymentTerms: 'Net 30' }
];

const CUSTOMERS_LIST = [
  { name: 'Rajesh Nair', mobile: '9876543210', email: 'rajesh.nair@example.com', address: '12, 4th Cross, Malleshwaram, Bengaluru' },
  { name: 'Lakshmi Venkatesh', mobile: '9876543211', email: 'lakshmi.v@example.com', address: '45/1, Indiranagar 100ft Rd, Bengaluru' },
  { name: 'Mohammed Farooq', mobile: '9876543212', email: 'farooq.m@example.com', address: '78, Commercial Street, Bengaluru' },
  { name: 'Anita Deshmukh', mobile: '9876543213', email: 'anita.d@example.com', address: '19, Jayanagar 4th Block, Bengaluru' },
  { name: 'Suresh Patil', mobile: '9876543214', email: 'suresh.patil@example.com', address: '88, Koramangala 5th Block, Bengaluru' },
  { name: 'Deepa Hegde', mobile: '9876543215', email: 'deepa.h@example.com', address: '102, HSR Layout Sector 2, Bengaluru' },
  { name: 'Gopal Krishna', mobile: '9876543216', email: 'gopal.k@example.com', address: '55, Basavanagudi, Bengaluru' },
  { name: 'Pooja Agarwal', mobile: '9876543217', email: 'pooja.a@example.com', address: '304, Whitefield Main Rd, Bengaluru' },
  { name: 'Vikas Shenoy', mobile: '9876543218', email: 'vikas.s@example.com', address: '67, Rajajinagar 1st Block, Bengaluru' },
  { name: 'Kavitha Sundaram', mobile: '9876543219', email: 'kavitha.s@example.com', address: '14, JP Nagar 2nd Phase, Bengaluru' },
  { name: 'Arun Bhat', mobile: '9876543220', email: 'arun.bhat@example.com', address: '90, Banashankari 3rd Stage, Bengaluru' },
  { name: 'Meenakshi Iyer', mobile: '9876543221', email: 'meenakshi.i@example.com', address: '22, BTM Layout 1st Stage, Bengaluru' }
];

function businessDate(dateObj, timeZone = TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(dateObj);
  const fields = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

function shiftCalendarDay(isoDate, offsetDays) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/**
 * Perform deterministic 60-day seed operation
 */
function seedDemoData(targetPath, daysCount = 60) {
  const dbFile = path.resolve(targetPath);
  if (!fs.existsSync(dbFile)) {
    throw new Error(`Target database file does not exist: ${dbFile}`);
  }

  const raw = fs.readFileSync(dbFile, 'utf8').replace(/^\uFEFF/, '');
  const db = JSON.parse(raw);

  // Check if demo data was already seeded
  const alreadySeeded = db.settings?.demoSeeded === SEED_TAG ||
    db.medicines?.some(m => m.seedTag === SEED_TAG);

  if (alreadySeeded) {
    return {
      status: 'IDEMPOTENT_SKIPPED',
      message: 'Demo data is already present with SEED_TAG ' + SEED_TAG,
      dbFile
    };
  }

  // Ensure base structure
  const arrays = ['medicines', 'sales', 'transactions', 'customers', 'suppliers', 'purchases', 'returns', 'expenses', 'users', 'payments'];
  for (const k of arrays) {
    if (!Array.isArray(db[k])) db[k] = [];
  }
  if (!db.settings || typeof db.settings !== 'object') db.settings = {};

  const settingsBeforeSeed = JSON.parse(JSON.stringify(db.settings));

  // Setup Shop Settings
  db.settings.shopName = STORE_NAME;
  db.settings.currency = CURRENCY;
  db.settings.timeZone = TIMEZONE;
  db.settings.address = 'Shop #14, Ground Floor, 100ft Ring Road, Indiranagar, Bengaluru 560038';
  db.settings.phone = '+91 80 2525 0199';
  db.settings.gstNumber = '29AABCP1234D1ZM';
  db.settings.drugLicence = 'DL-KA-BNG-KA01-2024-8844';
  db.settings.demoSeeded = SEED_TAG;
  db.settings.seededAt = new Date().toISOString();
  db.settings.demoSeedPreviousSettings = settingsBeforeSeed;

  // Initialize/preserve ID sequences
  let nextMedicineId = db.nextMedicineId || (db.medicines.reduce((m, x) => Math.max(m, x.id || 0), 0) + 1);
  let nextSaleId = db.nextSaleId || (db.sales.reduce((m, x) => Math.max(m, x.id || 0), 0) + 1);
  let nextCustomerId = db.nextCustomerId || (db.customers.reduce((m, x) => Math.max(m, x.id || 0), 0) + 1);
  let nextSupplierId = db.nextSupplierId || (db.suppliers.reduce((m, x) => Math.max(m, x.id || 0), 0) + 1);
  let nextPurchaseId = db.nextPurchaseId || (db.purchases.reduce((m, x) => Math.max(m, x.id || 0), 0) + 1);
  let nextReturnId = db.nextReturnId || (db.returns.reduce((m, x) => Math.max(m, x.id || 0), 0) + 1);
  let nextExpenseId = db.nextExpenseId || (db.expenses.reduce((m, x) => Math.max(m, x.id || 0), 0) + 1);

  // Seed suppliers (4 suppliers)
  const seededSuppliers = [];
  for (const sup of SUPPLIERS_LIST) {
    let existing = db.suppliers.find(s => s.name === sup.name);
    if (!existing) {
      existing = {
        id: nextSupplierId++,
        ...sup,
        createdAt: new Date().toISOString(),
        seedTag: SEED_TAG
      };
      db.suppliers.push(existing);
      db.transactions.unshift({
        id: crypto.randomUUID(),
        type: 'SUPPLIER_CREATED',
        details: `${existing.name} added`,
        qty: 0,
        medicineId: null,
        at: new Date().toISOString(),
        seedTag: SEED_TAG
      });
    }
    seededSuppliers.push(existing);
  }

  // 3. Seed Customers (12 customers)
  const seededCustomers = [];
  for (const cust of CUSTOMERS_LIST) {
    let existing = db.customers.find(c => c.name === cust.name);
    if (!existing) {
      existing = {
        id: nextCustomerId++,
        ...cust,
        createdAt: new Date().toISOString(),
        seedTag: SEED_TAG
      };
      db.customers.push(existing);
      db.transactions.unshift({
        id: crypto.randomUUID(),
        type: 'CUSTOMER_CREATED',
        details: `${existing.name} added`,
        qty: 0,
        medicineId: null,
        at: new Date().toISOString(),
        seedTag: SEED_TAG
      });
    }
    seededCustomers.push(existing);
  }

  // Calculate 60-day calendar date window
  const now = new Date();
  const currentDay = businessDate(now, TIMEZONE);
  const calendarDays = [];
  for (let i = daysCount - 1; i >= 0; i--) {
    calendarDays.push(shiftCalendarDay(currentDay, -i));
  }
  const windowStart = calendarDays[0];
  const windowEnd = calendarDays[calendarDays.length - 1];

  for (const spec of DEMO_BASELINE_MEDICINES) {
    if (db.medicines.some(medicine => medicine.name === spec.name)) continue;
    const medicine = {
      id: nextMedicineId++,
      ...spec,
      seedTag: SEED_TAG,
      initialOpeningStock: spec.stock
    };
    db.medicines.push(medicine);
    db.transactions.unshift({
      id: crypto.randomUUID(),
      type: 'OPENING_STOCK',
      details: `${medicine.name}: opening stock +${medicine.stock}`,
      qty: medicine.stock,
      medicineId: medicine.id,
      at: `${windowStart}T08:00:00.000Z`,
      seedTag: SEED_TAG
    });
    db.transactions.unshift({
      id: crypto.randomUUID(),
      type: 'MEDICINE_CREATED',
      details: `${medicine.name} created`,
      qty: 0,
      medicineId: medicine.id,
      at: `${windowStart}T08:00:00.000Z`,
      seedTag: SEED_TAG
    });
  }

  // 4. Seed Products & Batches (100–105 products)
  const seededMedicines = [];
  let barcodeNum = 890123456100;
  for (let i = 0; i < MEDICINE_CATALOGUE.length; i++) {
    const medSpec = MEDICINE_CATALOGUE[i];
    let existing = db.medicines.find(m => m.name === medSpec.name);
    if (!existing) {
      // Expiry dates: some expiring within 90 days (for alert testing), most 1-3 years out
      let expiryDate;
      if (i % 15 === 0) {
        // Expiring in 30-75 days
        expiryDate = shiftCalendarDay(currentDay, randomInt(30, 75));
      } else if (i % 25 === 0) {
        // Expiring in 10-25 days
        expiryDate = shiftCalendarDay(currentDay, randomInt(10, 25));
      } else {
        expiryDate = shiftCalendarDay(currentDay, randomInt(365, 900));
      }

      // Opening stock: generous enough to support historical sales without negative stock
      // Fast movers have higher opening stock
      const isFastMover = i < 25;
      const openingStock = isFastMover ? randomInt(120, 220) : randomInt(40, 90);

      const batchCode = `BN-${String.fromCharCode(65 + (i % 26))}${100 + i}`;
      const barcode = `890${barcodeNum++}`;

      existing = {
        id: nextMedicineId++,
        name: medSpec.name,
        generic: medSpec.generic,
        brand: medSpec.brand,
        batch: batchCode,
        expiry: expiryDate,
        price: round(medSpec.price),
        cost: round(medSpec.cost),
        stock: openingStock, // will track current balance
        minStock: medSpec.minStock,
        barcode: barcode,
        seedTag: SEED_TAG,
        initialOpeningStock: openingStock
      };

      db.medicines.push(existing);

      db.transactions.unshift({
        id: crypto.randomUUID(),
        type: 'OPENING_STOCK',
        details: `${existing.name}: opening stock +${openingStock}`,
        qty: openingStock,
        medicineId: existing.id,
        at: `${windowStart}T08:00:00.000Z`,
        seedTag: SEED_TAG
      });
      db.transactions.unshift({
        id: crypto.randomUUID(),
        type: 'MEDICINE_CREATED',
        details: `${existing.name} created`,
        qty: 0,
        medicineId: existing.id,
        at: `${windowStart}T08:00:00.000Z`,
        seedTag: SEED_TAG
      });
    }
    seededMedicines.push(existing);
  }

  // 5. Purchases & Supplier Deliveries across the 60-day period
  // Create 15-20 periodic purchase deliveries replenishing stock
  const purchaseDays = [3, 7, 12, 17, 22, 27, 32, 37, 42, 47, 52, 57];
  for (let pIdx = 0; pIdx < purchaseDays.length; pIdx++) {
    const dayOffset = purchaseDays[pIdx];
    if (dayOffset >= calendarDays.length) continue;
    const poDateStr = calendarDays[dayOffset];
    const sup = seededSuppliers[pIdx % seededSuppliers.length];

    // Pick 5 to 10 medicines to reorder
    const orderItems = [];
    const numItems = randomInt(5, 9);
    for (let k = 0; k < numItems; k++) {
      const med = seededMedicines[(pIdx * 7 + k * 11) % seededMedicines.length];
      const qty = randomInt(20, 50);
      const unitCost = med.cost;
      const lineTotal = round(qty * unitCost);
      const newBatch = `PO-${med.batch}-${pIdx + 1}`;
      const expiry = shiftCalendarDay(poDateStr, randomInt(400, 800));

      orderItems.push({
        medicineId: med.id,
        name: med.name,
        quantity: qty,
        receivedQuantity: qty, // Full receipt
        cost: unitCost,
        batch: newBatch,
        expiry: expiry,
        lineTotal: lineTotal
      });

      // Stock and cost update upon receipt
      med.stock += qty;
      med.cost = unitCost;
      med.batch = newBatch;
      med.expiry = expiry;

      db.transactions.unshift({
        id: crypto.randomUUID(),
        type: 'PURCHASE_RECEIPT',
        details: `PO-${poDateStr.replaceAll('-', '')}-${String(pIdx + 1).padStart(4, '0')}: ${med.name} stock +${qty}; batch ${newBatch}`,
        qty: qty,
        medicineId: med.id,
        at: `${poDateStr}T10:30:00.000Z`,
        seedTag: SEED_TAG
      });
    }

    const totalSpend = round(orderItems.reduce((sum, item) => sum + item.lineTotal, 0));
    const po = {
      id: nextPurchaseId++,
      purchaseNo: `PO-${poDateStr.replaceAll('-', '')}-${String(pIdx + 1).padStart(4, '0')}`,
      supplierId: sup.id,
      supplier: sup.name,
      date: `${poDateStr}T10:00:00.000Z`,
      status: 'RECEIVED',
      items: orderItems,
      total: totalSpend,
      updatedAt: `${poDateStr}T10:35:00.000Z`,
      seedTag: SEED_TAG
    };
    db.purchases.unshift(po);
    db.transactions.unshift({
      id: crypto.randomUUID(),
      type: 'PURCHASE_CREATED',
      details: `${po.purchaseNo} from ${po.supplier}; total ₹${po.total}`,
      qty: 0,
      medicineId: null,
      at: `${poDateStr}T10:00:00.000Z`,
      seedTag: SEED_TAG
    });
  }

  // 6. Sales Invoices across 60 days (target: 1,000–1,500 total invoices)
  // ~20-30 invoices per day with multiple line items, ensuring realistic pharmacy patterns
  const completedInvoices = [];
  const paymentModes = ['CASH', 'UPI', 'CARD', 'CREDIT'];
  const paymentWeights = [0.45, 0.35, 0.15, 0.05];

  function pickPaymentMode() {
    const r = rng();
    let acc = 0;
    for (let i = 0; i < paymentModes.length; i++) {
      acc += paymentWeights[i];
      if (r <= acc) return paymentModes[i];
    }
    return 'CASH';
  }

  for (let dayIndex = 0; dayIndex < calendarDays.length; dayIndex++) {
    const dayStr = calendarDays[dayIndex];
    // Number of invoices per day: weekdays 18-28, weekends 25-35
    const dayOfWeek = new Date(`${dayStr}T12:00:00Z`).getUTCDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const invoicesToday = isWeekend ? randomInt(23, 31) : randomInt(18, 26);

    for (let invIdx = 0; invIdx < invoicesToday; invIdx++) {
      // Hour distribution: 09:00 to 21:00
      const hour = randomInt(9, 21);
      const minute = randomInt(0, 59);
      const second = randomInt(0, 59);
      const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
      const isoTimestamp = `${dayStr}T${timeStr}.000Z`;

      // Customer
      const isRegistered = rng() < 0.35;
      const cust = isRegistered ? randomChoice(seededCustomers) : null;
      const custName = cust ? cust.name : 'Walk-in customer';
      const custId = cust ? cust.id : null;

      // Lines per invoice: 1 to 4 items
      const numLines = randomChoice([1, 1, 2, 2, 2, 3, 3, 4]);
      const selectedMeds = [];
      const lineItems = [];
      let subtotal = 0;

      for (let l = 0; l < numLines; l++) {
        // Fast movers have higher probability
        let med;
        let attempts = 0;
        do {
          const medIndex = rng() < 0.65 ? randomInt(0, 30) : randomInt(0, seededMedicines.length - 1);
          med = seededMedicines[medIndex];
          attempts++;
        } while (selectedMeds.includes(med.id) && attempts < 10);

        if (selectedMeds.includes(med.id)) continue;
        selectedMeds.push(med.id);

        // Quantity: usually 1 or 2, occasionally 3-5
        const maxEligible = Math.min(med.stock - 2, 4); // leave at least 2 units in stock
        if (maxEligible <= 0) continue; // skip if near stockout

        const qty = randomInt(1, Math.min(maxEligible, randomChoice([1, 1, 1, 2, 2, 3])));
        const lineTotal = round(med.price * qty);

        lineItems.push({
          medicineId: med.id,
          name: med.name,
          batch: med.batch,
          expiry: med.expiry,
          quantity: qty,
          unitPrice: med.price,
          unitCost: med.cost, // Ensure acquisition cost is recorded
          lineTotal: lineTotal
        });

        // Deduct inventory
        med.stock -= qty;
        subtotal += lineTotal;

        db.transactions.unshift({
          id: crypto.randomUUID(),
          type: 'SALE',
          details: `Invoice: ${med.name} quantity -${qty}`,
          qty: -qty,
          medicineId: med.id,
          at: isoTimestamp,
          seedTag: SEED_TAG
        });
      }

      if (!lineItems.length) continue;

      subtotal = round(subtotal);
      // Small realistic discount: 0%, 5% or fixed Rs 5-20 occasionally
      let discount = 0;
      if (subtotal > 300 && rng() < 0.25) {
        discount = round(Math.min(subtotal * 0.05, 50));
      }
      const total = round(subtotal - discount);

      let pMode = pickPaymentMode();
      if (pMode === 'CREDIT' && !custId) {
        pMode = 'CASH'; // Credit sales require customer
      }

      const invoiceId = nextSaleId++;
      const invoiceNo = `PH-${dayStr.replaceAll('-', '')}-${String(invoiceId).padStart(5, '0')}`;

      // Update audit details to match actual invoiceNo
      for (const itm of lineItems) {
        // find corresponding audit record and adjust details
        const tx = db.transactions.find(t => t.at === isoTimestamp && t.medicineId === itm.medicineId && t.qty === -itm.quantity);
        if (tx) tx.details = `${invoiceNo}: ${itm.name} quantity -${itm.quantity}`;
      }

      const sale = {
        id: invoiceId,
        invoiceNo: invoiceNo,
        date: isoTimestamp,
        customerId: custId,
        customer: custName,
        paymentMode: pMode,
        items: lineItems,
        subtotal: subtotal,
        discount: discount,
        total: total,
        paid: pMode === 'CREDIT' ? 0 : total,
        balance: pMode === 'CREDIT' ? total : 0,
        status: 'COMPLETED',
        seedTag: SEED_TAG
      };

      db.sales.unshift(sale);
      completedInvoices.push(sale);

      db.transactions.unshift({
        id: crypto.randomUUID(),
        type: 'INVOICE_CREATED',
        details: `${invoiceNo} total ₹${total}`,
        qty: 0,
        medicineId: null,
        at: isoTimestamp,
        seedTag: SEED_TAG
      });
    }
  }

  // 7. Sales Returns linked to original invoices (realistic ~1.5% - 2% of invoices)
  // Create ~20-25 returns distributed across the 60-day period
  const eligibleSalesForReturn = completedInvoices.filter(s => s.items.length > 0 && s.status === 'COMPLETED');
  const returnCount = Math.min(25, Math.floor(eligibleSalesForReturn.length * 0.02));

  for (let rIdx = 0; rIdx < returnCount; rIdx++) {
    const sale = eligibleSalesForReturn[(rIdx * 53) % eligibleSalesForReturn.length];
    const returnItem = sale.items[0];
    const returnQty = 1; // Return 1 unit
    const originalSaleDate = sale.date.slice(0, 10);
    // Return happens 1 to 3 days after purchase
    const returnDateStr = shiftCalendarDay(originalSaleDate, randomInt(1, 3));
    if (returnDateStr > currentDay) continue; // Don't return in future

    const returnTimestamp = `${returnDateStr}T16:00:00.000Z`;
    const lineRevenue = sale.subtotal > 0
      ? returnItem.lineTotal - sale.discount * returnItem.lineTotal / sale.subtotal
      : returnItem.lineTotal;
    const refundAmount = round(lineRevenue / returnItem.quantity * returnQty);

    const med = seededMedicines.find(m => m.id === returnItem.medicineId);
    if (med) {
      med.stock += returnQty; // Restore stock
    }

    const returnRecord = {
      id: nextReturnId++,
      returnNo: `SR-${String(rIdx + 1).padStart(5, '0')}`,
      saleId: sale.id,
      invoiceNo: sale.invoiceNo,
      date: returnTimestamp,
      reason: randomChoice(['Doctor changed prescription', 'Excess strips purchased', 'Allergic sensitivity', 'Patient recovered']),
      items: [{
        medicineId: returnItem.medicineId,
        name: returnItem.name,
        quantity: returnQty,
        amount: refundAmount
      }],
      total: refundAmount,
      seedTag: SEED_TAG
    };

    db.returns.unshift(returnRecord);

    db.transactions.unshift({
      id: crypto.randomUUID(),
      type: 'SALES_RETURN',
      details: `${sale.invoiceNo}: ${returnItem.name} stock +${returnQty}`,
      qty: returnQty,
      medicineId: returnItem.medicineId,
      at: returnTimestamp,
      seedTag: SEED_TAG
    });

    db.transactions.unshift({
      id: crypto.randomUUID(),
      type: 'RETURN_CREATED',
      details: `${returnRecord.returnNo} linked to ${sale.invoiceNo}; ₹${returnRecord.total}`,
      qty: 0,
      medicineId: null,
      at: returnTimestamp,
      seedTag: SEED_TAG
    });
  }

  // 8. Business Expenses (Rent, Electricity, Staff Salaries, Maintenance across the 2 months)
  const expenseSpecs = [
    { title: 'Shop Rent - Month 1', category: 'Rent', amount: 35000, dayOffset: -55 },
    { title: 'Electricity & Air Conditioning', category: 'Utilities', amount: 4800, dayOffset: -50 },
    { title: 'Pharmacist & Staff Salary', category: 'Salary', amount: 45000, dayOffset: -45 },
    { title: 'Bio-waste & Sanitization Disposal', category: 'Other', amount: 2200, dayOffset: -38 },
    { title: 'Wholesale Transport & Logistics', category: 'Transport', amount: 3100, dayOffset: -32 },
    { title: 'Shop Rent - Month 2', category: 'Rent', amount: 35000, dayOffset: -25 },
    { title: 'Electricity & Commercial Power', category: 'Utilities', amount: 5100, dayOffset: -20 },
    { title: 'Staff Salaries & Overtime', category: 'Salary', amount: 47000, dayOffset: -15 },
    { title: 'In-store Packaging & Thermal Rolls', category: 'Other', amount: 1850, dayOffset: -10 },
    { title: 'Local Courier & Delivery Service', category: 'Transport', amount: 2600, dayOffset: -4 }
  ];

  for (const exp of expenseSpecs) {
    const expDate = shiftCalendarDay(currentDay, exp.dayOffset);
    const expRecord = {
      id: nextExpenseId++,
      title: exp.title,
      category: exp.category,
      amount: exp.amount,
      date: expDate,
      notes: 'Operational store overhead for demo simulation',
      createdAt: `${expDate}T10:00:00.000Z`,
      seedTag: SEED_TAG
    };
    db.expenses.unshift(expRecord);
    db.transactions.unshift({
      id: crypto.randomUUID(),
      type: 'EXPENSE_CREATED',
      details: `${expRecord.title}: ₹${expRecord.amount}`,
      qty: 0,
      medicineId: null,
      at: `${expDate}T10:00:00.000Z`,
      seedTag: SEED_TAG
    });
  }

  // Update auto-increment sequences
  db.nextMedicineId = nextMedicineId;
  db.nextSaleId = nextSaleId;
  db.nextCustomerId = nextCustomerId;
  db.nextSupplierId = nextSupplierId;
  db.nextPurchaseId = nextPurchaseId;
  db.nextReturnId = nextReturnId;
  db.nextExpenseId = nextExpenseId;

  // Persist updated database
  const tmp = dbFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, dbFile);

  return {
    status: 'SEEDED_SUCCESSFULLY',
    dbFile,
    metrics: {
      medicinesSeeded: db.medicines.filter(medicine => medicine.seedTag === SEED_TAG).length,
      suppliersSeeded: seededSuppliers.length,
      customersSeeded: seededCustomers.length,
      purchasesSeeded: purchaseDays.length,
      salesInvoicesSeeded: completedInvoices.length,
      returnsSeeded: db.returns.filter(r => r.seedTag === SEED_TAG).length,
      expensesSeeded: expenseSpecs.length,
      windowStart,
      windowEnd,
      daysCount
    }
  };
}

/**
 * Verify financial, inventory, and reconciliation integrity
 */
function verifyDatabaseIntegrity(targetPath, daysCount = 60) {
  const dbFile = path.resolve(targetPath);
  if (!fs.existsSync(dbFile)) {
    throw new Error(`Target database file does not exist: ${dbFile}`);
  }

  const raw = fs.readFileSync(dbFile, 'utf8').replace(/^\uFEFF/, '');
  const db = JSON.parse(raw);

  // Ensure collections exist
  const arrays = ['medicines', 'sales', 'transactions', 'customers', 'suppliers', 'purchases', 'returns', 'expenses', 'users', 'payments'];
  for (const k of arrays) {
    if (!Array.isArray(db[k])) db[k] = [];
  }
  if (!db.settings || typeof db.settings !== 'object') db.settings = {};

  const errors = [];
  const warnings = [];

  // 1. Inventory Integrity Checks
  for (const med of db.medicines) {
    if (med.stock < 0) {
      errors.push(`Negative stock detected for medicine ${med.name} (id: ${med.id}): stock = ${med.stock}`);
    }
    if (!Number.isFinite(med.price) || med.price <= 0) {
      errors.push(`Invalid selling price for ${med.name}: ${med.price}`);
    }
    if (!Number.isFinite(med.cost) || med.cost < 0) {
      errors.push(`Invalid unit cost for ${med.name}: ${med.cost}`);
    }
    if (!med.batch) {
      warnings.push(`Missing batch code for ${med.name}`);
    }
    if (!med.expiry || !/^\d{4}-\d{2}-\d{2}$/.test(med.expiry)) {
      warnings.push(`Invalid or missing expiry date for ${med.name}: ${med.expiry}`);
    }
  }

  // 2. Reconciliation of Stock from Transactions
  // opening + purchases + returns - sales + adjustments == current stock
  const medStockCalculated = new Map();
  // find initial opening stock
  for (const med of db.medicines) {
    medStockCalculated.set(med.id, 0);
  }

  // Sort transactions chronologically
  const sortedTx = [...db.transactions].sort((a, b) => new Date(a.at) - new Date(b.at));
  for (const tx of sortedTx) {
    if (tx.medicineId && medStockCalculated.has(tx.medicineId)) {
      if (['OPENING_STOCK', 'PURCHASE_RECEIPT', 'SALES_RETURN', 'ADJUSTMENT', 'SALE'].includes(tx.type)) {
        medStockCalculated.set(tx.medicineId, medStockCalculated.get(tx.medicineId) + tx.qty);
      }
    }
  }

  let reconciledCount = 0;
  for (const med of db.medicines) {
    if (med.seedTag === SEED_TAG) {
      const computed = medStockCalculated.get(med.id);
      if (computed !== med.stock) {
        errors.push(`Stock mismatch for seeded medicine ${med.name} (id: ${med.id}): recorded=${med.stock}, computed=${computed}`);
      } else {
        reconciledCount++;
      }
    }
  }

  // 3. Sales and Line items verification
  let totalSalesRevenue = 0;
  let totalCostBasis = 0;
  for (const sale of db.sales) {
    const sumLines = round(sale.items.reduce((s, it) => s + it.lineTotal, 0));
    if (Math.abs(sumLines - sale.subtotal) > 0.05) {
      errors.push(`Subtotal mismatch in invoice ${sale.invoiceNo}: subtotal=${sale.subtotal}, linesSum=${sumLines}`);
    }
    const calcTotal = round(sale.subtotal - (sale.discount || 0));
    if (Math.abs(calcTotal - sale.total) > 0.05) {
      errors.push(`Total mismatch in invoice ${sale.invoiceNo}: total=${sale.total}, calc=${calcTotal}`);
    }
    for (const it of sale.items) {
      if (it.unitCost === null || it.unitCost === undefined || !Number.isFinite(it.unitCost)) {
        errors.push(`Missing cost basis on line item ${it.name} in invoice ${sale.invoiceNo}`);
      } else {
        totalCostBasis += (it.unitCost * it.quantity);
      }
    }
    totalSalesRevenue += sale.total;
  }

  // 4. Returns integrity
  for (const ret of db.returns) {
    const origSale = db.sales.find(s => s.id === ret.saleId);
    if (!origSale) {
      errors.push(`Return ${ret.returnNo} references non-existent sale ID ${ret.saleId}`);
      continue;
    }
    for (const retItem of ret.items) {
      const soldItem = origSale.items.find(i => i.medicineId === retItem.medicineId);
      if (!soldItem) {
        errors.push(`Return ${ret.returnNo} contains medicine ${retItem.medicineId} not found in sale ${origSale.invoiceNo}`);
      } else if (retItem.quantity > soldItem.quantity) {
        errors.push(`Return ${ret.returnNo} quantity (${retItem.quantity}) exceeds sold quantity (${soldItem.quantity}) in ${origSale.invoiceNo}`);
      }
    }
  }

  // 5. Test Analytics integration (using application's real analytics.js)
  const currentDay = businessDate(new Date(), TIMEZONE);
  const fromDate = shiftCalendarDay(currentDay, - (daysCount - 1));
  const toDate = currentDay;
  const analyticsResult = buildSalesAnalytics(db, {
    from: fromDate,
    to: toDate,
    days: daysCount,
    previousFrom: shiftCalendarDay(fromDate, -daysCount),
    previousTo: shiftCalendarDay(toDate, -daysCount),
    timeZone: TIMEZONE,
    sort: 'units'
  });

  const reportResult = buildSalesReport(db, {
    from: fromDate,
    to: toDate,
    timeZone: TIMEZONE
  });

  return {
    verified: errors.length === 0,
    errors,
    warnings,
    counts: {
      medicines: db.medicines.length,
      seededMedicines: db.medicines.filter(m => m.seedTag === SEED_TAG).length,
      suppliers: db.suppliers.length,
      customers: db.customers.length,
      purchases: db.purchases.length,
      salesInvoices: db.sales.length,
      returns: db.returns.length,
      expenses: db.expenses.length,
      transactions: db.transactions.length,
      reconciledProducts: reconciledCount
    },
    analytics: {
      netRevenue: analyticsResult.metrics.revenue,
      transactions: analyticsResult.metrics.transactions,
      unitsSold: analyticsResult.metrics.unitsSold,
      cogs: analyticsResult.metrics.cogs,
      grossProfit: analyticsResult.metrics.grossProfit,
      grossMarginPercent: analyticsResult.metrics.grossMarginPercent,
      costAvailable: analyticsResult.metrics.costAvailable,
      lowStockProducts: analyticsResult.metrics.lowStockProducts,
      stockoutRiskProducts: analyticsResult.metrics.stockoutRiskProducts,
      expiringProducts: analyticsResult.metrics.expiringProducts,
      bestSellersCount: analyticsResult.bestSellers.length,
      dailySeriesPoints: analyticsResult.dailySeries?.length || 0
    },
    report: {
      netSales: reportResult.revenue,
      cogs: reportResult.cogs,
      grossMargin: reportResult.grossMargin,
      purchaseSpend: reportResult.purchaseSpend,
      expenseTotal: reportResult.expenseTotal,
      estimatedNet: reportResult.estimatedNet
    }
  };
}

/**
 * Remove only items marked with SEED_TAG
 */
function cleanupDemoData(targetPath) {
  const dbFile = path.resolve(targetPath);
  if (!fs.existsSync(dbFile)) {
    throw new Error(`Target database file does not exist: ${dbFile}`);
  }

  const raw = fs.readFileSync(dbFile, 'utf8').replace(/^\uFEFF/, '');
  const db = JSON.parse(raw);

  const initialCounts = {
    medicines: db.medicines.length,
    sales: db.sales.length,
    returns: db.returns.length,
    purchases: db.purchases.length,
    suppliers: db.suppliers.length,
    customers: db.customers.length,
    expenses: db.expenses.length,
    transactions: db.transactions.length,
    users: db.users.length
  };

  db.medicines = db.medicines.filter(m => m.seedTag !== SEED_TAG);
  db.sales = db.sales.filter(s => s.seedTag !== SEED_TAG);
  db.returns = db.returns.filter(r => r.seedTag !== SEED_TAG);
  db.purchases = db.purchases.filter(p => p.seedTag !== SEED_TAG);
  db.suppliers = db.suppliers.filter(s => s.seedTag !== SEED_TAG);
  db.customers = db.customers.filter(c => c.seedTag !== SEED_TAG);
  db.expenses = db.expenses.filter(e => e.seedTag !== SEED_TAG);
  db.transactions = db.transactions.filter(t => t.seedTag !== SEED_TAG);
  db.users = db.users.filter(u => u.seedTag !== SEED_TAG);

  if (db.settings?.demoSeeded === SEED_TAG) {
    const previousSettings = db.settings.demoSeedPreviousSettings;
    db.settings = previousSettings && typeof previousSettings === 'object' && !Array.isArray(previousSettings)
      ? previousSettings
      : {};
  }

  const tmp = dbFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, dbFile);

  return {
    status: 'CLEANED_SUCCESSFULLY',
    removed: {
      medicines: initialCounts.medicines - db.medicines.length,
      sales: initialCounts.sales - db.sales.length,
      returns: initialCounts.returns - db.returns.length,
      purchases: initialCounts.purchases - db.purchases.length,
      suppliers: initialCounts.suppliers - db.suppliers.length,
      customers: initialCounts.customers - db.customers.length,
      expenses: initialCounts.expenses - db.expenses.length,
      transactions: initialCounts.transactions - db.transactions.length,
      users: initialCounts.users - db.users.length
    }
  };
}

// CLI handler
function parseArgs() {
  const args = process.argv.slice(2);
  const command = args[0] || 'verify';
  const targetArg = args.find(a => a.startsWith('--target='));
  const daysArg = args.find(a => a.startsWith('--days='));

  const targetPath = targetArg ? targetArg.slice('--target='.length) : path.join(__dirname, '..', 'data', 'db.json');
  const days = daysArg ? Number(daysArg.slice('--days='.length)) : 60;

  if (!targetPath.trim()) throw new Error('--target must be a non-empty path.');
  if (!Number.isInteger(days) || days < 1 || days > 366) {
    throw new Error('--days must be a whole number from 1 to 366.');
  }

  return { command, targetPath, days };
}

if (require.main === module) {
  const { command, targetPath, days } = parseArgs();

  try {
    if (command === 'seed') {
      console.log(`Executing deterministic seeder on ${targetPath} (${days} days)...`);
      const res = seedDemoData(targetPath, days);
      console.log(JSON.stringify(res, null, 2));
    } else if (command === 'verify') {
      console.log(`Verifying data integrity on ${targetPath}...`);
      const res = verifyDatabaseIntegrity(targetPath, days);
      console.log(JSON.stringify(res, null, 2));
    } else if (command === 'cleanup') {
      console.log(`Cleaning up demo records with tag ${SEED_TAG} on ${targetPath}...`);
      const res = cleanupDemoData(targetPath);
      console.log(JSON.stringify(res, null, 2));
    } else {
      console.error(`Unknown command: ${command}. Use 'seed', 'verify', or 'cleanup'.`);
      process.exit(1);
    }
  } catch (err) {
    console.error('Operation failed:', err);
    process.exit(1);
  }
}

module.exports = { seedDemoData, verifyDatabaseIntegrity, cleanupDemoData, SEED_TAG };
