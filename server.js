const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(bodyParser.json());

const DATA_PATH = "./veriler.json";
const LAST_BATCH_PATH = "./lastBatch.json";

// Veri okuma ve yazma fonksiyonları
const readData = () => {
  try {
    return JSON.parse(fs.readFileSync(DATA_PATH));
  } catch {
    return [];
  }
};

const writeData = (data) => {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
};

const readLastBatch = () => {
  try {
    return JSON.parse(fs.readFileSync(LAST_BATCH_PATH));
  } catch {
    return { lastBatchId: null };
  }
};

const writeLastBatch = (batchId) => {
  fs.writeFileSync(LAST_BATCH_PATH, JSON.stringify({ lastBatchId: batchId }));
};

// DELETE tek bir etkinlik
app.delete("/api/etkinlikler/:id", (req, res) => {
  const { id } = req.params;
  let data = readData();
  const filtered = data.filter((item) => item.id !== id);

  if (filtered.length === data.length) {
    return res
      .status(404)
      .json({ success: false, message: "Etkinlik bulunamadı" });
  }

  writeData(filtered);

  res.json({ success: true, message: `Etkinlik başarıyla silindi` });
});

// GET tüm etkinlikler
app.get("/api/etkinlikler", (req, res) => {
  const etkinlikler = readData();
  res.json({ etkinlikler });
});

// GET etkinlik başlıkları
app.get("/api/etkinlikler/headers", (req, res) => {
  try {
    const etkinlikler = readData();

    if (!Array.isArray(etkinlikler) || etkinlikler.length === 0) {
      return res.json({ success: true, headers: [] });
    }

    // Tüm etkinliklerin key'lerini topla
    const headers = new Set();
    etkinlikler.forEach((etkinlik) => {
      Object.keys(etkinlik).forEach((key) => headers.add(key));
    });

    // id ve batchId hariç filtrele
    const filteredHeaders = Array.from(headers).filter(
      (key) => key !== "id" && key !== "batchId"
    );

    res.json({ success: true, headers: filteredHeaders });
  } catch (error) {
    console.error("Başlıklar alınırken hata:", error);
    res.status(500).json({ success: false, message: "Sunucu hatası" });
  }
});

// GET tüm batch'leri getir (tarih sıralı)
app.get("/api/batches", (req, res) => {
  const data = readData();

  // Unique batch'leri ve bilgilerini topla
  const batchMap = new Map();

  data.forEach((item) => {
    if (item.batchId && !batchMap.has(item.batchId)) {
      // İlk item'dan batch bilgisini al
      batchMap.set(item.batchId, {
        batchId: item.batchId,
        uploadDate: item.uploadDate || new Date().toISOString(), // Eğer kayıtlı değilse bugünü al
        recordCount: 0,
      });
    }
    if (item.batchId) {
      batchMap.get(item.batchId).recordCount++;
    }
  });

  // Array'e çevir ve tarihe göre sırala (en yeni önce)
  const batches = Array.from(batchMap.values()).sort(
    (a, b) => new Date(b.uploadDate) - new Date(a.uploadDate)
  );

  res.json({ success: true, batches });
});

// POST etkinlikler (batchId ekle)
app.post("/api/etkinlikler", (req, res) => {
  const { data } = req.body;

  if (!Array.isArray(data)) {
    return res.status(400).json({ success: false, message: "Geçersiz veri" });
  }

  const batchId = uuidv4();
  const uploadDate = new Date().toISOString();

  const normalizedData = data.map((item) => ({
    id: uuidv4(),
    batchId,
    uploadDate, // Tarih bilgisi ekle
    ...item,
  }));

  const existingData = readData();
  const combinedData = [...existingData, ...normalizedData];

  writeData(combinedData);
  writeLastBatch(batchId);

  res.json({ success: true, recordCount: normalizedData.length, batchId });
});

// GET son batchId
app.get("/api/last-batch", (req, res) => {
  const lastBatch = readLastBatch();
  res.json(lastBatch);
});

// DELETE son batch
app.delete("/api/etkinlikler/batch/:batchId", (req, res) => {
  const { batchId } = req.params;
  let data = readData();
  const filtered = data.filter((item) => item.batchId !== batchId);

  if (filtered.length === data.length) {
    return res
      .status(404)
      .json({ success: false, message: "Batch bulunamadı" });
  }

  writeData(filtered);

  const lastBatch = readLastBatch();
  if (lastBatch.lastBatchId === batchId) {
    writeLastBatch(null);
  }

  res.json({ success: true, message: `Batch ${batchId} başarıyla silindi` });
});

app.listen(PORT, () =>
  console.log(`Backend çalışıyor 👉 http://localhost:${PORT}`)
);
