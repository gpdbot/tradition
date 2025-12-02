let log = null;
let fileQueue = [];

document.addEventListener("DOMContentLoaded", () => {
    let consoleElem = document.querySelector("#console");
    let progressCount = 0;

    log = {
        log(x) {
            consoleElem.appendChild(createDiv(x.toString()));
            consoleElem.scrollTop = consoleElem.scrollHeight;
        },
        progress() {
            progressCount++;
            if (progressCount > 20) {
                consoleElem.innerHTML = "작업 중...<br>";
                progressCount = 0;
            }
            consoleElem.appendChild(document.createTextNode("■"));
        },
        clear() {
            consoleElem.innerHTML = "";
            progressCount = 0;
        }
    };

    document.querySelector("#fileform").addEventListener("change", function() {
        addFiles(this.files);
        this.value = '';
    });

    document.querySelector("#coverform").addEventListener("change", function(e) {
        if (this.files && this.files[0]) {
            updateImgBlob(this.files[0]);
        }
        e.stopPropagation();
    });

    document.querySelector("#dropzone").addEventListener("click", (e) => {
        if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || e.target.classList.contains('remove-btn')) return;
        document.querySelector("#fileform").click();
    });

    document.querySelector(".cover").addEventListener("click", (e) => {
        document.querySelector("#coverform").click();
        e.stopPropagation();
    });

    document.getElementById("btn-speed").addEventListener("click", (e) => {
        e.stopPropagation();
        runCompression("STORE");
    });
    document.getElementById("btn-size").addEventListener("click", (e) => {
        e.stopPropagation();
        runCompression("DEFLATE");
    });

    // 초기 이미지 설정 (cover.js에 정의된 img_blob 사용)
    if (typeof img_blob !== 'undefined') {
        updateImgBlob(img_blob);
    }
});

function createDiv(innerText) {
    let element = document.createElement("DIV");
    element.innerHTML = innerText;
    return element;
}

function updateImgBlob(blob) {
    img_blob = blob;
    let reader = new FileReader();
    reader.onload = () => {
        document.querySelector("#cover-preview").setAttribute("src", reader.result);
    };
    reader.readAsDataURL(img_blob);
}

function renderFileList() {
    let list = document.querySelector("#file-list");
    let container = document.querySelector("#file-list-container");
    let controls = document.querySelector("#control-panel");

    list.innerHTML = "";

    if (fileQueue.length > 0) {
        container.style.display = "block";
        controls.style.display = "block";

        fileQueue.forEach((file, index) => {
            let li = document.createElement("li");
            let displayName = file.fullPath ? file.fullPath : file.name;
            li.innerHTML = `<span>${displayName}</span> <span class="remove-btn" onclick="removeFile(${index})">x</span>`;
            list.appendChild(li);
        });
    } else {
        container.style.display = "none";
        controls.style.display = "none";
    }
}

function addFiles(fileList) {
    if (!fileList || fileList.length === 0) return;
    for (let i = 0; i < fileList.length; i++) {
        fileQueue.push(fileList[i]);
    }
    renderFileList();
}

window.removeFile = function(index) {
    fileQueue.splice(index, 1);
    renderFileList();
    event.stopPropagation();
}

// [개선됨] Web Worker용 코드 (바이너리 처리 로직)
const workerCode = `
self.onmessage = function(e) {
    const { zipData, imgData } = e.data;
    const img_len = imgData.byteLength;
    const zipview = new DataView(zipData);
    const len = zipview.byteLength;

    // [개선 2] EOCD 탐색 개선 (뒤에서부터 시그니처 검색)
    // EOCD Signature: 0x06054b50
    let eocd = -1;
    for (let i = len - 22; i >= 0; i--) {
        if (zipview.getUint32(i, true) === 0x06054b50) {
            eocd = i;
            break;
        }
    }

    if (eocd === -1) {
        self.postMessage({ error: "ZIP 구조를 찾을 수 없습니다." });
        return;
    }

    // Central Directory 시작 위치 보정
    let cdr = zipview.getUint32(eocd + 16, true);
    zipview.setUint32(eocd + 16, cdr + img_len, true);

    // Central Directory 레코드 순회 및 오프셋 보정
    while (cdr < eocd) {
        // [개선 1] 주석 길이(k) 포함하여 오프셋 계산 오류 수정
        let n = zipview.getUint16(cdr + 28, true); // 파일명 길이
        let m = zipview.getUint16(cdr + 30, true); // 확장 필드 길이
        let k = zipview.getUint16(cdr + 32, true); // 파일 주석 길이 (추가됨)

        let old_offset = zipview.getUint32(cdr + 42, true);
        zipview.setUint32(cdr + 42, old_offset + img_len, true);

        cdr += 46 + n + m + k; // k 추가
    }

    // 결과 Blob 생성 (이미지 + 수정된 ZIP)
    const resultBlob = new Blob([imgData, zipData], {type: "image/png"});
    self.postMessage({ success: true, blob: resultBlob });
};
`;

function runCompression(compressionMode) {
    if (fileQueue.length === 0) {
        alert("파일이 없습니다.");
        return;
    }

    log.clear();
    let zip = new JSZip();
    log.log("압축 준비 중...");

    fileQueue.forEach(file => {
        let path = file.fullPath ? file.fullPath : file.name;
        zip.file(path, file);
    });

    log.log("압축하는 중...");

    let progressInterval = setInterval(() => {
        log.progress();
    }, 100);

    let options = {
        type: "blob",
        compression: compressionMode,
        compressionOptions: { level: compressionMode === "STORE" ? 1 : 6 }
    };

    zip.generateAsync(options).then((zipBlob) => {
        log.log("이미지와 결합 중..."); // [추가됨] 상태 메시지

        // [개선 3] Web Worker 생성 및 실행
        const blobURL = URL.createObjectURL(new Blob([workerCode], { type: 'application/javascript' }));
        const worker = new Worker(blobURL);

        // 이미지와 ZIP 데이터를 ArrayBuffer로 읽어서 워커에 전달
        Promise.all([zipBlob.arrayBuffer(), img_blob.arrayBuffer()]).then(([zipData, imgData]) => {
            worker.postMessage({ zipData, imgData }, [zipData, imgData]); // Transferable objects 사용으로 성능 최적화
        });

        worker.onmessage = function(e) {
            clearInterval(progressInterval); // 작업 완료 시 멈춤
            
            if (e.data.error) {
                alert(e.data.error);
                log.log("오류 발생!");
            } else if (e.data.success) {
                let filenameInput = document.getElementById("filename").value.trim();
                if (!filenameInput) filenameInput = "Result";
                
                saveAs(e.data.blob, filenameInput + ".png");
                log.log("완료!");
            }
            
            worker.terminate(); // 워커 종료
            URL.revokeObjectURL(blobURL); // 메모리 해제
        };

        worker.onerror = function(e) {
            clearInterval(progressInterval);
            alert("워커 처리 중 오류가 발생했습니다.");
            console.error(e);
            worker.terminate();
        };

    }, (err) => {
        clearInterval(progressInterval);
        alert("압축 중 오류: " + err);
    });
}

window.addEventListener("dragover", function(e) {
    e.preventDefault();
}, false);

window.addEventListener("drop", function(e) {
    e.preventDefault();
    e.stopPropagation();

    let items = e.dataTransfer.items;
    let isSingleFolder = false;
    let folderName = "";

    if (items) {
        let entries = [];
        for (let i = 0; i < items.length; i++) {
            if (items[i].webkitGetAsEntry) {
                entries.push(items[i].webkitGetAsEntry());
            }
        }

        if (entries.length === 1 && entries[0].isDirectory) {
            isSingleFolder = true;
            folderName = entries[0].name;
        }

        scanFiles(entries).then(files => {
            files.forEach(f => fileQueue.push(f));

            if (isSingleFolder && folderName) {
                document.getElementById("filename").value = folderName;
            }

            renderFileList();
        });
    } else {
        addFiles(e.dataTransfer.files);
    }
}, false);

function scanFiles(entries) {
    return new Promise(resolve => {
        let files = [];
        let len = entries.length;
        if (len === 0) { resolve(files); return; }

        let completed = 0;
        entries.forEach(entry => {
            if (entry.isFile) {
                entry.file(file => {
                    file.fullPath = entry.fullPath.substring(1);
                    files.push(file);
                    completed++;
                    if (completed === len) resolve(files);
                });
            } else if (entry.isDirectory) {
                let dirReader = entry.createReader();
                let allEntries = [];
                
                // [수정됨] 디렉토리 엔트리를 모두 읽을 때까지 반복 (브라우저 제한 대응)
                const readDir = () => {
                    dirReader.readEntries(subEntries => {
                        if (subEntries.length > 0) {
                            allEntries = allEntries.concat(subEntries);
                            readDir();
                        } else {
                            scanFiles(allEntries).then(subFiles => {
                                files = files.concat(subFiles);
                                completed++;
                                if (completed === len) resolve(files);
                            });
                        }
                    });
                };
                readDir();
            }
        });
    });
}
