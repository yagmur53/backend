const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const fs = require("fs").promises; // Async fs kullan
const fsSync = require("fs"); // Sadece başlangıç kontrolleri için
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(bodyParser.json());

const DATA_PATH = "./veriler.json";
const LAST_BATCH_PATH = "./lastBatch.json";

// Dosya kilitleme için mutex
const fileLocks = {
  data: false,
  batch: false,
};

// Mutex fonksiyonu
const waitForLock = async (lockName) => {
  while (fileLocks[lockName]) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  fileLocks[lockName] = true;
};

const releaseLock = (lockName) => {
  fileLocks[lockName] = false;
};

// Veri okuma ve yazma fonksiyonları (async)
const readData = async () => {
  try {
    await waitForLock("data");
    const data = await fs.readFile(DATA_PATH, "utf8");
    releaseLock("data");
    return JSON.parse(data);
  } catch (error) {
    releaseLock("data");
    console.error("Veri okuma hatası:", error);
    return [];
  }
};

const writeData = async (data) => {
  try {
    await waitForLock("data");

    // Önce geçici dosyaya yaz
    const tempPath = DATA_PATH + ".tmp";
    await fs.writeFile(tempPath, JSON.stringify(data, null, 2));

    // Atomik olarak dosyayı değiştir
    await fs.rename(tempPath, DATA_PATH);

    releaseLock("data");
    return true;
  } catch (error) {
    releaseLock("data");
    console.error("Veri yazma hatası:", error);

    // Geçici dosyayı temizle
    try {
      await fs.unlink(DATA_PATH + ".tmp");
    } catch {}

    throw error;
  }
};

const readLastBatch = async () => {
  try {
    await waitForLock("batch");
    const data = await fs.readFile(LAST_BATCH_PATH, "utf8");
    releaseLock("batch");
    return JSON.parse(data);
  } catch (error) {
    releaseLock("batch");
    return { lastBatchId: null };
  }
};

const writeLastBatch = async (batchId) => {
  try {
    await waitForLock("batch");

    const tempPath = LAST_BATCH_PATH + ".tmp";
    await fs.writeFile(tempPath, JSON.stringify({ lastBatchId: batchId }));
    await fs.rename(tempPath, LAST_BATCH_PATH);

    releaseLock("batch");
  } catch (error) {
    releaseLock("batch");
    console.error("Batch yazma hatası:", error);

    try {
      await fs.unlink(LAST_BATCH_PATH + ".tmp");
    } catch {}

    throw error;
  }
};

// Başlangıçta dosyaları kontrol et (senkron)
const initializeFiles = () => {
  try {
    if (!fsSync.existsSync(DATA_PATH)) {
      fsSync.writeFileSync(DATA_PATH, JSON.stringify([], null, 2));
    }
    if (!fsSync.existsSync(LAST_BATCH_PATH)) {
      fsSync.writeFileSync(
        LAST_BATCH_PATH,
        JSON.stringify({ lastBatchId: null })
      );
    }
  } catch (error) {
    console.error("Dosya başlatma hatası:", error);
  }
};

// Başlangıçta dosyaları hazırla
initializeFiles();

// DELETE tek bir etkinlik (async)
app.delete("/api/etkinlikler/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // ID formatını kontrol et
    if (!id || typeof id !== "string") {
      return res.status(400).json({
        success: false,
        message: "Geçersiz ID formatı",
      });
    }

    const data = await readData();
    const initialLength = data.length;
    const filtered = data.filter((item) => item.id !== id);

    if (filtered.length === initialLength) {
      return res.status(404).json({
        success: false,
        message: "Etkinlik bulunamadı",
      });
    }

    // Veri yazma işlemini try-catch ile koru
    await writeData(filtered);

    console.log(`Etkinlik silindi: ID=${id}, Kalan kayıt: ${filtered.length}`);

    res.json({
      success: true,
      message: "Etkinlik başarıyla silindi",
      remainingCount: filtered.length,
    });
  } catch (error) {
    console.error("Etkinlik silme hatası:", error);
    res.status(500).json({
      success: false,
      message: "Sunucu hatası - etkinlik silinemedi",
    });
  }
});

// GET tüm etkinlikler (async)
app.get("/api/etkinlikler", async (req, res) => {
  try {
    const etkinlikler = await readData();
    res.json({ etkinlikler });
  } catch (error) {
    console.error("Etkinlikler getirme hatası:", error);
    res.status(500).json({
      success: false,
      message: "Veriler alınamadı",
    });
  }
});

// GET etkinlik başlıkları (async)
app.get("/api/etkinlikler/headers", async (req, res) => {
  try {
    const etkinlikler = await readData();

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

// GET tüm batch'leri getir (async)
app.get("/api/batches", async (req, res) => {
  try {
    const data = await readData();

    // Unique batch'leri ve bilgilerini topla
    const batchMap = new Map();

    data.forEach((item) => {
      if (item.batchId && !batchMap.has(item.batchId)) {
        batchMap.set(item.batchId, {
          batchId: item.batchId,
          uploadDate: item.uploadDate || new Date().toISOString(),
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
  } catch (error) {
    console.error("Batch'ler getirme hatası:", error);
    res.status(500).json({
      success: false,
      message: "Batch verileri alınamadı",
    });
  }
});

// POST etkinlikler (async)
app.post("/api/etkinlikler", async (req, res) => {
  try {
    const { data } = req.body;

    if (!Array.isArray(data)) {
      return res.status(400).json({
        success: false,
        message: "Geçersiz veri formatı",
      });
    }

    if (data.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Boş veri gönderilemez",
      });
    }

    const batchId = uuidv4();
    const uploadDate = new Date().toISOString();

    const normalizedData = data.map((item) => ({
      id: uuidv4(),
      batchId,
      uploadDate,
      ...item,
    }));

    const existingData = await readData();
    const combinedData = [...existingData, ...normalizedData];

    await writeData(combinedData);
    await writeLastBatch(batchId);

    console.log(
      `Yeni batch eklendi: ID=${batchId}, Kayıt sayısı=${normalizedData.length}`
    );

    res.json({
      success: true,
      recordCount: normalizedData.length,
      batchId,
      totalRecords: combinedData.length,
    });
  } catch (error) {
    console.error("Etkinlik ekleme hatası:", error);
    res.status(500).json({
      success: false,
      message: "Veri kaydedilemedi",
    });
  }
});

// GET son batchId (async)
app.get("/api/last-batch", async (req, res) => {
  try {
    const lastBatch = await readLastBatch();
    res.json(lastBatch);
  } catch (error) {
    console.error("Son batch getirme hatası:", error);
    res.json({ lastBatchId: null });
  }
});

// DELETE batch (async)
app.delete("/api/etkinlikler/batch/:batchId", async (req, res) => {
  try {
    const { batchId } = req.params;

    if (!batchId || typeof batchId !== "string") {
      return res.status(400).json({
        success: false,
        message: "Geçersiz batch ID",
      });
    }

    const data = await readData();
    const initialLength = data.length;
    const filtered = data.filter((item) => item.batchId !== batchId);

    if (filtered.length === initialLength) {
      return res.status(404).json({
        success: false,
        message: "Batch bulunamadı",
      });
    }

    const deletedCount = initialLength - filtered.length;

    await writeData(filtered);

    // Son batch kontrolü
    const lastBatch = await readLastBatch();
    if (lastBatch.lastBatchId === batchId) {
      // Kalan batch'lerden en yenisini bul
      const remainingBatches = new Set();
      filtered.forEach((item) => {
        if (item.batchId) remainingBatches.add(item.batchId);
      });

      if (remainingBatches.size === 0) {
        await writeLastBatch(null);
      } else {
        // En yeni batch'i bul
        const batchDates = {};
        filtered.forEach((item) => {
          if (item.batchId && item.uploadDate) {
            if (
              !batchDates[item.batchId] ||
              batchDates[item.batchId] < item.uploadDate
            ) {
              batchDates[item.batchId] = item.uploadDate;
            }
          }
        });

        const newestBatch = Object.entries(batchDates).sort(
          ([, a], [, b]) => new Date(b) - new Date(a)
        )[0];

        await writeLastBatch(newestBatch ? newestBatch[0] : null);
      }
    }

    console.log(
      `Batch silindi: ID=${batchId}, Silinen kayıt=${deletedCount}, Kalan kayıt=${filtered.length}`
    );

    res.json({
      success: true,
      message: `Batch başarıyla silindi`,
      deletedCount,
      remainingCount: filtered.length,
    });
  } catch (error) {
    console.error("Batch silme hatası:", error);
    res.status(500).json({
      success: false,
      message: "Sunucu hatası - batch silinemedi",
    });
  }
});

// Hata yakalama middleware
app.use((error, req, res, next) => {
  console.error("Beklenmeyen hata:", error);
  res.status(500).json({
    success: false,
    message: "Sunucu hatası",
  });
});

app.listen(PORT, () =>
  console.log(`Backend çalışıyor 👉 http://localhost:${PORT}`)
);
