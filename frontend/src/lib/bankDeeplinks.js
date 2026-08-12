const VIETQR_GUI = "A000000727";
const VIETQR_SERVICE_CODE = "QRIBFTTA";
const VND_CURRENCY_CODE = "704";
const COUNTRY_CODE = "VN";

function encodeEmvField(id, value) {
  if (value.length > 99) {
    throw new Error(`EMV field ${id} is too long.`);
  }

  return `${id}${String(value.length).padStart(2, "0")}${value}`;
}

function crc16Ccitt(value) {
  let crc = 0xffff;

  for (let i = 0; i < value.length; i += 1) {
    crc ^= value.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }

  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function normalizeAmount(amount) {
  const digits = String(amount).replace(/[^\d]/g, "");
  if (!digits || Number(digits) <= 0) {
    throw new Error("VietQR payload requires a positive amount.");
  }

  return digits;
}

export function buildVietQrPayload(input) {
  const bankBin = input.bankBin.replace(/\s+/g, "");
  const accountNumber = input.accountNumber.replace(/\s+/g, "");
  const description = input.description.trim();

  if (!bankBin) throw new Error("VietQR payload requires bankBin.");
  if (!accountNumber) throw new Error("VietQR payload requires accountNumber.");
  if (!description) throw new Error("VietQR payload requires description.");

  const consumerInfo = encodeEmvField("00", bankBin) + encodeEmvField("01", accountNumber);
  const merchantInfo =
    encodeEmvField("00", VIETQR_GUI) +
    encodeEmvField("01", consumerInfo) +
    encodeEmvField("02", VIETQR_SERVICE_CODE);
  const additionalData = encodeEmvField("08", description);

  const payloadWithoutCrc =
    encodeEmvField("00", "01") +
    encodeEmvField("01", "12") +
    encodeEmvField("38", merchantInfo) +
    encodeEmvField("53", VND_CURRENCY_CODE) +
    encodeEmvField("54", normalizeAmount(input.amount)) +
    encodeEmvField("58", COUNTRY_CODE) +
    encodeEmvField("62", additionalData);

  const crcInput = `${payloadWithoutCrc}6304`;
  return `${crcInput}${crc16Ccitt(crcInput)}`;
}

export const BANK_DEEPLINKS = {
  mb: {
    name: "MB Bank",
    build: (qr) => `mbbank://applink?targetPage=QRPay&qrContent=${encodeURIComponent(qr)}`,
  },
  vietinbank: {
    name: "VietinBank iPay",
    build: (qr) => `vietinbankipay://host.qrTransfer?targetPage=QRPay&qrContent=${encodeURIComponent(qr)}`,
  },
  techcombank: {
    name: "Techcombank",
    build: (qr) => `tcb://applink?targetPage=QRPay&qrContent=${encodeURIComponent(qr)}`,
  },
  vpbank: {
    name: "VPBank NEO",
    build: (qr) => `vpbankneo://applink?targetPage=DLPay&qrContent=${encodeURIComponent(qr)}`,
  },
  msb: {
    name: "MSB",
    build: (qr) => `msbmbank://applink?targetPage=QRPay&qrContent=${encodeURIComponent(qr)}`,
  },
  acb: {
    name: "ACB ONE",
    build: (qr) => `acbone://ZaloPay/external/transactions/v1/qrcode?qrCode=${encodeURIComponent(qr)}`,
  },
  bvbank: {
    name: "BVBank DigiMi",
    build: (qr) => `bvbankdigimi://zalopay?qr_value=${encodeURIComponent(qr)}`,
  },
  sacombank: {
    name: "Sacombank Pay",
    build: (qr) => `sacombankpay://zalopay?qr_value=${encodeURIComponent(qr)}`,
  },
  shb: {
    name: "SHB SAHA",
    build: (qr) => `saha://zalopay?qr_value=${encodeURIComponent(qr)}`,
  },
  cake: {
    name: "Cake",
    build: (qr) => `cake.vn://zalopay?qr_value=${encodeURIComponent(qr)}`,
  },
  vikki: {
    name: "Vikki",
    build: (qr) => `vikki://zalopay?qr_value=${encodeURIComponent(qr)}`,
  },
  eximbank: {
    name: "Eximbank",
    build: (qr) => `eximbankomnimobile://ZaloPay/${encodeURIComponent(qr)}`,
  },
  pvcombank: {
    name: "PVComBank",
    build: (qr) => `pvcb://ZaloPay/${encodeURIComponent(qr)}`,
  },
  tpbank: {
    name: "TPBank",
    build: (qr) => `hydro://ZaloPay/${encodeURIComponent(qr)}`,
  },
  namabank: {
    name: "NamABank",
    build: (qr) => `nabqrtransfermoney://ops.namabank.com.vn/?qr_data=${encodeURIComponent(qr)}`,
  },
};

export const BANK_DEEPLINK_OPTIONS = [
  { key: "mb", name: BANK_DEEPLINKS.mb.name },
  { key: "techcombank", name: BANK_DEEPLINKS.techcombank.name },
  { key: "msb", name: BANK_DEEPLINKS.msb.name },
  { key: "vpbank", name: BANK_DEEPLINKS.vpbank.name },
  { key: "vietinbank", name: BANK_DEEPLINKS.vietinbank.name },
  { key: "acb", name: BANK_DEEPLINKS.acb.name },
  { key: "sacombank", name: BANK_DEEPLINKS.sacombank.name },
  { key: "cake", name: BANK_DEEPLINKS.cake.name },
  { key: "bvbank", name: BANK_DEEPLINKS.bvbank.name },
  { key: "shb", name: BANK_DEEPLINKS.shb.name },
  { key: "tpbank", name: BANK_DEEPLINKS.tpbank.name },
  { key: "pvcombank", name: BANK_DEEPLINKS.pvcombank.name },
  { key: "eximbank", name: BANK_DEEPLINKS.eximbank.name },
  { key: "namabank", name: BANK_DEEPLINKS.namabank.name },
  { key: "vikki", name: BANK_DEEPLINKS.vikki.name },
  { key: "timo", name: "Timo" },
];

export function buildQrBankDeeplink(bankKey, qrPayload) {
  if (!qrPayload || !qrPayload.startsWith("000201")) {
    throw new Error("Invalid QR payload. Expected EMV/VietQR payload starting with 000201.");
  }

  const bank = BANK_DEEPLINKS[bankKey];
  if (!bank) {
    throw new Error(`Unsupported bank deeplink key: ${bankKey}`);
  }

  return {
    bankKey,
    url: bank.build(qrPayload),
    requiresQrPayload: true,
  };
}

export function buildTimoDeeplink(payload) {
  if (!payload.bankCode) throw new Error("Timo deeplink requires bankCode.");
  if (!payload.bankName) throw new Error("Timo deeplink requires bankName.");
  if (!payload.accNumber) throw new Error("Timo deeplink requires accNumber.");
  if (!payload.amount) throw new Error("Timo deeplink requires amount.");

  const params = new URLSearchParams({
    source: "dl",
    bankCode: payload.bankCode,
    bankName: payload.bankName,
    accNumber: payload.accNumber,
    amount: String(payload.amount),
    description: payload.description || "",
    editable: payload.editable === true ? "true" : "false",
  });

  return {
    bankKey: "timo",
    url: `https://my.timo.vn/move-money?${params.toString()}`,
    requiresQrPayload: false,
    note: "Timo uses HTTPS universal link and field-based transfer data.",
  };
}

export function buildBankDeeplink(args) {
  if (args.bankKey === "timo") {
    if (!args.timoPayload) {
      throw new Error("Missing timoPayload for Timo deeplink.");
    }

    return buildTimoDeeplink(args.timoPayload);
  }

  if (!args.qrPayload) {
    throw new Error("Missing qrPayload for bank deeplink.");
  }

  return buildQrBankDeeplink(args.bankKey, args.qrPayload);
}

export function openDeeplinkWithFallback(args) {
  const timeoutMs = args.timeoutMs ?? 1500;
  let didHidePage = false;

  const handleVisibilityChange = () => {
    if (document.hidden) {
      didHidePage = true;
    }
  };

  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.location.href = args.deeplinkUrl;

  window.setTimeout(() => {
    document.removeEventListener("visibilitychange", handleVisibilityChange);

    if (!didHidePage) {
      args.onFallback?.();
    }
  }, timeoutMs);
}
