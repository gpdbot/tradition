// gpdbot/tradition/tradition-main/res/tradition.js

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

    // [수정 1] 일반 파일 업로드
    document.querySelector("#fileform").addEventListener("change", function() {
        addFiles(this.files);
        this.value = '';
    });

    // [수정 1] 폴더 업로드 처리
    document.querySelector("#folderform").addEventListener("change", function() {
        addFiles(this.files);
        this.value = '';
    });

    // 커버 이미지 처리
    document.querySelector("#coverform").addEventListener("change", function(e) {
        if (this.files && this.files[0]) {
            updateImgBlob(this.files[0]);
        }
        e.stopPropagation();
    });

    // [수정 1] 드롭존 클릭 시 일반 파일 업로드 트리거
    document.querySelector("#dropzone").addEventListener("click", (e) => {
        // 버튼이나 입력창, 폴더 업로드 링크 클릭 시 무시
        if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || e.target.classList.contains('remove-btn') || e.target.id === 'btn-folder-upload') return;
        document.querySelector("#fileform").click();
    });

    // [수정 1] 폴더 업로드 텍스트 클릭 시 트리거
    document.querySelector("#btn-folder-upload").addEventListener("click", (e) => {
        e.stopPropagation();
        document.querySelector("#folderform").click();
    });

    document.querySelector(".cover").addEventListener("click", (e) => {
        document.querySelector("#coverform").click();
        e.stopPropagation();
    });

    // [수정 3] 저장 버튼 하나로 통합 및 압축률 옵션 처리
    document.getElementById("btn-save").addEventListener("click", (e) => {
        e.stopPropagation();
        const isHighCompress = document.getElementById("chk-compress").checked;
        const mode = isHighCompress ? "DEFLATE" : "STORE";
        
        // 버튼 텍스트 업데이트 (시각적 피드백)
        const btnText = isHighCompress ? "저장 (고압축)" : "저장 (속도 우선)";
        e.target.innerText = btnText;

        runCompression(mode);
    });

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

// Web Worker 코드 (바이너리 보정 로직)
const workerCode = `
self.onmessage = function(e) {
    const { zipData, imgData } = e.data;
    const img_len = imgData.byteLength;
    const zipview = new DataView(zipData);
    const len = zipview.byteLength;

    // EOCD 탐색
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

    let cdr = zipview.getUint32(eocd + 16, true);
    zipview.setUint32(eocd + 16, cdr + img_len, true);

    while (cdr < eocd) {
        let n = zipview.getUint16(cdr + 28, true);
        let m = zipview.getUint16(cdr + 30, true);
        let k = zipview.getUint16(cdr + 32, true);

        let old_offset = zipview.getUint32(cdr + 42, true);
        zipview.setUint32(cdr + 42, old_offset + img_len, true);

        cdr += 46 + n + m + k;
    }

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
    
    // [수정 4] 단일 ZIP 파일 최적화: 압축 해제 없이 바로 이미지화
    let isSingleZip = fileQueue.length === 1 && fileQueue[0].name.toLowerCase().endsWith('.zip');
    let dataPromise;

    if (isSingleZip) {
        log.log("단일 ZIP 파일 감지. 재압축 없이 병합합니다...");
        // 파일을 바로 ArrayBuffer로 읽음 (JSZip 사용 안 함)
        dataPromise = fileQueue[0].arrayBuffer();
    } else {
        log.log("압축 준비 중...");
        let zip = new JSZip();
        fileQueue.forEach(file => {
            let path = file.fullPath ? file.fullPath : file.name;
            zip.file(path, file);
        });

        log.log("압축하는 중...");
        let options = {
            type: "blob",
            compression: compressionMode,
            compressionOptions: { level: compressionMode === "STORE" ? 1 : 6 }
        };
        // JSZip으로 압축 후 ArrayBuffer 변환
        dataPromise = zip.generateAsync(options).then(blob => blob.arrayBuffer());
    }

    let progressInterval = setInterval(() => {
        log.progress();
    }, 100);

    dataPromise.then((zipArrayBuffer) => {
        log.log("이미지와 결합 중...");

        const blobURL = URL.createObjectURL(new Blob([workerCode], { type: 'application/javascript' }));
        const worker = new Worker(blobURL);

        Promise.all([Promise.resolve(zipArrayBuffer), img_blob.arrayBuffer()]).then(([zipData, imgData]) => {
            worker.postMessage({ zipData, imgData }, [zipData, imgData]);
        });

        worker.onmessage = function(e) {
            clearInterval(progressInterval);
            
            if (e.data.error) {
                alert(e.data.error);
                log.log("오류 발생: " + e.data.error);
            } else if (e.data.success) {
                let filenameInput = document.getElementById("filename").value.trim();
                if (!filenameInput) filenameInput = "Result";
                
                saveAs(e.data.blob, filenameInput + ".png");
                log.log("완료!");
            }
            
            worker.terminate();
            URL.revokeObjectURL(blobURL);
        };

        worker.onerror = function(e) {
            clearInterval(progressInterval);
            alert("워커 처리 중 오류가 발생했습니다.");
            console.error(e);
            worker.terminate();
        };

    }, (err) => {
        clearInterval(progressInterval);
        alert("처리 중 오류: " + err);
    });
}

window.addEventListener("dragover", function(e) {
    e.preventDefault();
}, false);

window.addEventListener("drop", function(e) {
    e.preventDefault();
    e.stopPropagation();

    let items = e.dataTransfer.items;
    
    // [수정 2] 폴더 이름 자동 입력 기능 삭제 (Result 유지)
    // 기존의 isSingleFolder, folderName 로직 제거

    if (items) {
        let entries = [];
        for (let i = 0; i < items.length; i++) {
            if (items[i].webkitGetAsEntry) {
                entries.push(items[i].webkitGetAsEntry());
            }
        }

        scanFiles(entries).then(files => {
            files.forEach(f => fileQueue.push(f));
            // 파일명 변경 로직 제거됨
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
