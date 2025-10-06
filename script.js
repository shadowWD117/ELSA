// Buat / buka database IndexedDB
let db;
const request = indexedDB.open("kamusDB", 1);

request.onupgradeneeded = (event) => {
  db = event.target.result;
  if (!db.objectStoreNames.contains("kosakata")) {
    db.createObjectStore("kosakata", { keyPath: "kata" });
  }
};

request.onsuccess = (event) => {
  db = event.target.result;
  console.log("Database siap");
  loadData(); // masukkan data pertama kali
};

request.onerror = (event) => {
  console.error("Error DB:", event);
};

// Masukkan data dari words.json jika masih kosong
function loadData() {
  fetch("words.json")
    .then(res => res.json())
    .then(data => {
      const tx = db.transaction("kosakata", "readwrite");
      const store = tx.objectStore("kosakata");

      data.forEach(item => store.put(item)); // {kata: "apel", arti: "buah apel"}
      console.log("Data kosakata dimasukkan ke IndexedDB");
    });
}

// Fungsi cari kata
document.getElementById("search").addEventListener("input", (e) => {
  const keyword = e.target.value.toLowerCase();
  const tx = db.transaction("kosakata", "readonly");
  const store = tx.objectStore("kosakata");
  const request = store.get(keyword);

  request.onsuccess = () => {
    const result = request.result;
    const resultsEl = document.getElementById("results");
    resultsEl.innerHTML = "";

    if (result) {
      resultsEl.innerHTML = `<li><b>${result.kata}</b> : ${result.arti}</li>`;
    } else {
      resultsEl.innerHTML = "<li>Tidak ditemukan</li>";
    }
  };
});