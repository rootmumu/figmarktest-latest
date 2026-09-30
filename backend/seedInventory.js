require('dotenv').config();
const mongoose = require('mongoose');
const InventoryItem = require('./models/InventoryItem');

// Categories: ICs, Microcontrollers, Diodes, Sensors, Passives, Tools, Others

const components = [
  // ─── Passives ───────────────────────────────────────────────
  { name: 'Resistor',             category: 'Passives',        totalQuantity: 100, unitCost: 1,    location: 'S1' },
  { name: 'Capacitor',            category: 'Passives',        totalQuantity: 41,  unitCost: 5,    location: 'S1' },
  { name: 'Pot',                  category: 'Passives',        totalQuantity: 21,  unitCost: 15,   location: 'S1' },
  { name: '555 Timer',            category: 'Passives',        totalQuantity: 30,  unitCost: 8,    location: 'S1' },

  // ─── Diodes ─────────────────────────────────────────────────
  { name: 'Diode',                category: 'Diodes',          totalQuantity: 72,  unitCost: 3,    location: 'S1' },
  { name: 'MOSFET',               category: 'Diodes',          totalQuantity: 22,  unitCost: 20,   location: 'S1' },

  // ─── ICs ────────────────────────────────────────────────────
  { name: 'IC 7805',              category: 'ICs',             totalQuantity: 13,  unitCost: 12,   location: 'S2' },
  { name: 'IC 7809',              category: 'ICs',             totalQuantity: 5,   unitCost: 15,   location: 'S2' },
  { name: 'IC 741',               category: 'ICs',             totalQuantity: 14,  unitCost: 10,   location: 'S2' },
  { name: 'LM324N',               category: 'ICs',             totalQuantity: 14,  unitCost: 18,   location: 'S2' },
  { name: 'L298 Motor Driver',    category: 'ICs',             totalQuantity: 14,  unitCost: 55,   location: 'S2' },
  { name: 'BMS',                  category: 'ICs',             totalQuantity: 3,   unitCost: 120,  location: 'S2' },
  { name: 'PZEM Module',          category: 'ICs',             totalQuantity: 8,   unitCost: 350,  location: 'S2' },
  { name: 'SSR Module 10DA',      category: 'ICs',             totalQuantity: 2,   unitCost: 180,  location: 'S2' },

  // ─── Microcontrollers ────────────────────────────────────────
  { name: 'Arduino Uno',          category: 'Microcontrollers', totalQuantity: 20, unitCost: 350,  location: 'S3' },
  { name: 'Arduino (Extra)',      category: 'Microcontrollers', totalQuantity: 3,  unitCost: 350,  location: 'S3' },
  { name: 'ESP8266',              category: 'Microcontrollers', totalQuantity: 15, unitCost: 180,  location: 'S3' },
  { name: 'Raspberry Pi 5',      category: 'Microcontrollers', totalQuantity: 2,  unitCost: 6500, location: 'S3' },
  { name: 'Raspberry Pi 4',      category: 'Microcontrollers', totalQuantity: 3,  unitCost: 5000, location: 'S3' },
  { name: 'Stepper Motor Driver', category: 'Microcontrollers', totalQuantity: 2,  unitCost: 120,  location: 'S3' },

  // ─── Sensors ─────────────────────────────────────────────────
  { name: 'IR Sensor',            category: 'Sensors',         totalQuantity: 18, unitCost: 25,   location: 'S2' },
  { name: 'IR Sensor Module',     category: 'Sensors',         totalQuantity: 17, unitCost: 30,   location: 'S2' },
  { name: 'LDR',                  category: 'Sensors',         totalQuantity: 20, unitCost: 5,    location: 'S2' },
  { name: 'Ultrasonic Sensor',    category: 'Sensors',         totalQuantity: 23, unitCost: 50,   location: 'S2' },
  { name: 'DHT11',                category: 'Sensors',         totalQuantity: 10, unitCost: 60,   location: 'S2' },
  { name: 'MPU6050',              category: 'Sensors',         totalQuantity: 4,  unitCost: 120,  location: 'S2' },
  { name: 'Voltage Sensor',       category: 'Sensors',         totalQuantity: 5,  unitCost: 35,   location: 'S2' },
  { name: 'Current Sensor',       category: 'Sensors',         totalQuantity: 4,  unitCost: 80,   location: 'S2' },
  { name: 'Gas Sensor Module',    category: 'Sensors',         totalQuantity: 3,  unitCost: 150,  location: 'S2' },
  { name: 'GPS Module',           category: 'Sensors',         totalQuantity: 8,  unitCost: 450,  location: 'S2' },
  { name: 'GSM Module',           category: 'Sensors',         totalQuantity: 3,  unitCost: 550,  location: 'S2' },
  { name: 'MIC (Microphone)',     category: 'Sensors',         totalQuantity: 15, unitCost: 20,   location: 'S2' },

  // ─── Others ──────────────────────────────────────────────────
  { name: 'Servo Motor',          category: 'Others',          totalQuantity: 13, unitCost: 120,  location: 'S4' },
  { name: 'Stepper Motor',        category: 'Others',          totalQuantity: 4,  unitCost: 250,  location: 'S4' },
  { name: 'BO Motor',             category: 'Others',          totalQuantity: 25, unitCost: 60,   location: 'S4' },
  { name: 'Transformer (9V)',     category: 'Others',          totalQuantity: 15, unitCost: 80,   location: 'S4' },
  { name: 'Relay Module',         category: 'Others',          totalQuantity: 6,  unitCost: 45,   location: 'S4' },
  { name: 'Relay Cube',           category: 'Others',          totalQuantity: 16, unitCost: 35,   location: 'S4' },
  { name: 'LCD Display',          category: 'Others',          totalQuantity: 7,  unitCost: 120,  location: 'S4' },

  // ─── Tools ───────────────────────────────────────────────────
  { name: 'Soldering Iron',       category: 'Tools',           totalQuantity: 5,  unitCost: 350,  location: 'S4' },
  { name: 'Fixed Power Supply',   category: 'Tools',           totalQuantity: 2,  unitCost: 1500, location: 'S4' },
];

async function seed() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    let added = 0;
    let skipped = 0;

    for (const comp of components) {
      const existing = await InventoryItem.findOne({ name: comp.name });
      if (existing) {
        console.log(`⏭  Skipped (already exists): ${comp.name}`);
        skipped++;
        continue;
      }
      await InventoryItem.create({
        name: comp.name,
        category: comp.category,
        totalQuantity: comp.totalQuantity,
        availableQuantity: comp.totalQuantity, // no defectives
        defectiveQuantity: 0,
        unitCost: comp.unitCost,
        minThreshold: 5,
        location: comp.location,
        description: ''
      });
      console.log(`✅ Added: ${comp.name} (${comp.category}) — Qty: ${comp.totalQuantity}, Cost: ₹${comp.unitCost}, Shelf: ${comp.location}`);
      added++;
    }

    console.log(`\n🎉 Done! Added: ${added}, Skipped: ${skipped}`);
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

seed();
