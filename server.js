const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const multer = require("multer");
const xlsx = require("xlsx");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(bodyParser.json());

// Yükleme ayarları
const upload = multer({ dest: "uploads/" });

const DATA_PATH = "./veriler.json";
const CUSTOM_FIELDS_PATH = "./customFields.json";

// Dosyadan oku
const readData = () => {
  try {
    const raw = fs.readFileSync(DATA_PATH);
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
};

// Dosyaya yaz
const writeData = (data) => {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
};

// Custom Fields okuma/yazma
const readCustomFields = () => {
  try {
    const raw = fs.readFileSync(CUSTOM_FIELDS_PATH);
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
};

const writeCustomFields = (customFields) => {
  fs.writeFileSync(CUSTOM_FIELDS_PATH, JSON.stringify(customFields, null, 2));
};

// === Alias haritasını otomatik öğrenme fonksiyonu ===
const aliasMapPath = "./aliasMap.json";
const readAliasMap = () => {
  try {
    return JSON.parse(fs.readFileSync(aliasMapPath));
  } catch {
    return {};
  }
};
const writeAliasMap = (map) => {
  fs.writeFileSync(aliasMapPath, JSON.stringify(map, null, 2));
};

// Sabit alanlar - DynamicExcelReader'daki dbFields ile aynı olmalı
const STATIC_FIELDS = {
  id: "Toplantı / Faaliyet ID",
  ad: "Toplantının / Faaliyetin Adı",
  ulusal: "Ulusal / Uluslararası",
  tur: "Faaliyet Türü",
  tema: "Etkinlik Teması",
  baslama: "Başlama Tarihi",
  katilimci: "Yurt Dışından Katılımcı Sayısı",
  katilimTur: "Katılım Türü",
  kaliteKulturu: "Kalite Kültürünü Yaygınlaştırma Amacı Var Mı",
  duzenleyenBirim: "Düzenleyen Birim",
  faaliyetYurutucusu: "Faaliyet Yürütücüsü",
  kariyerMerkezi: "Kariyer Merkezi Faaliyeti Mi",
  bagimlilik: "Bağımlılıkla Mücadele Kapsamında Bir Faaliyet Mi",
  dezavantajli: "Dezavantajlı Gruplara Yönelik Faaliyet Mi",
  sektorIsbirligi: "Sektör İş Birliği Var Mı",
  yarisma: "Etkinlik Yarışma İçeriyor Mu",
  kalkinmaAraci: "Sürdürülebilir Kalkınma Amacı",
  url: "URL",
};

// Excel yükleme endpoint'i
app.post("/api/upload-excel", upload.single("file"), (req, res) => {
  const aliasMap = readAliasMap();
  const workbook = xlsx.readFile(req.file.path);
  const sheetName = workbook.SheetNames[0];
  const sheet = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
  });

  const headers = sheet[0];
  const dataRows = sheet.slice(1);

  // Yeni başlıkları aliasMap'e ekle
  headers.forEach((header) => {
    if (!Object.values(aliasMap).includes(header)) {
      aliasMap[header.toLowerCase()] = header;
    }
  });
  writeAliasMap(aliasMap);

  // Normalleştirilmiş veri
  const normalizedData = dataRows.map((row) => {
    let obj = {};
    headers.forEach((header, i) => {
      const normalizedKey = aliasMap[header.toLowerCase()] || header;
      obj[normalizedKey] = row[i];
    });
    return obj;
  });

  // JSON'a ekle
  const data = readData();
  normalizedData.forEach((item) => data.push({ id: uuidv4(), ...item }));
  writeData(data);

  res.json({ success: true, added: normalizedData.length });
});

app.get("/", (req, res) => {
  res.send("Sunucu çalışıyor 🚀");
});

// Belirli bir etkinliği sil
app.delete("/api/etkinlikler/:id", (req, res) => {
  const { id } = req.params;
  let etkinlikler = readData();

  const index = etkinlikler.findIndex((e) => e.id === id);
  if (index === -1) {
    return res
      .status(404)
      .json({ success: false, message: "Etkinlik bulunamadı" });
  }

  etkinlikler.splice(index, 1); // Listedeki o kaydı sil
  writeData(etkinlikler);

  res.json({ success: true, message: "Etkinlik silindi" });
});

// Mevcut etkinlikleri getir - YENİ FORMAT
app.get("/api/etkinlikler", (req, res) => {
  const etkinlikler = readData();
  const customFields = readCustomFields();

  // Response'u yeni formatta döndür
  res.json({
    etkinlikler: etkinlikler,
    customFields: customFields,
  });
});

app.post("/api/etkinlikler", (req, res) => {
  const { data, filename, overwrite, mapping } = req.body;

  if (!Array.isArray(data)) {
    return res
      .status(400)
      .json({ success: false, message: "Geçersiz veri formatı" });
  }

  const aliasMap = readAliasMap();
  let customFields = readCustomFields();

  // Mapping varsa aliasMap'i güncelle
  if (mapping && typeof mapping === "object") {
    Object.entries(mapping).forEach(([excelHeader, dbField]) => {
      // Alias map'i güncelle
      aliasMap[excelHeader.toLowerCase()] = dbField;

      // Eğer bu alan sabit alanlar arasında değilse, custom field olarak kaydet
      if (!STATIC_FIELDS[dbField]) {
        // Excel'den gelen veriye bakarak label'ı belirle
        customFields[dbField] = excelHeader; // veya daha iyi bir label belirleme mantığı
      }
    });

    writeAliasMap(aliasMap);
    writeCustomFields(customFields);
  }

  // Veriyi normalize et
  const normalizedData = data.map((item) => {
    const normalized = {};
    Object.entries(item).forEach(([key, value]) => {
      const normalizedKey = aliasMap[key.toLowerCase()] || key;
      normalized[normalizedKey] = value;
    });
    return { id: uuidv4(), ...normalized };
  });

  // Dosyaya yaz
  let existingData = [];
  if (!overwrite) {
    existingData = readData();
  }

  const combinedData = [...existingData, ...normalizedData];
  writeData(combinedData);

  res.json({
    success: true,
    recordCount: normalizedData.length,
    message: "Veri başarıyla kaydedildi",
  });
});

app.listen(PORT, () => {
  console.log(`Backend çalışıyor 👉 http://localhost:${PORT}`);
});
