let log = null;
let fileQueue = []; // [추가됨] 파일 대기열

document.addEventListener("DOMContentLoaded", () => {
	let consoleElem = document.querySelector("#console");
    let progressCount = 0; // [추가됨] 진행 바 카운트

	log = {
		log(x){
			consoleElem.appendChild(createDiv(x.toString()));
            // 로그가 추가될 때 스크롤을 아래로
            consoleElem.scrollTop = consoleElem.scrollHeight;
		},
		// [추가됨] 요구사항 4: 20칸 채우면 초기화
		progress(){
            progressCount++;
            if(progressCount > 20) {
                consoleElem.innerHTML = "압축하는 중...<br>"; // 기존 진행바 지움
                progressCount = 0;
            }
			consoleElem.appendChild(document.createTextNode("■"));
		},
		clear(){
			consoleElem.innerHTML = "";
            progressCount = 0;
		}
	};

    // [수정됨] 파일 선택 시 바로 압축하지 않고 큐에 추가
	document.querySelector("#fileform").addEventListener("change", function(){
		addFiles(this.files);
        // input value 초기화하여 같은 파일 다시 선택 가능하게 함
        this.value = ''; 
	});

    // [수정됨] 커버 이미지 변경 이벤트
	document.querySelector("#coverform").addEventListener("change", function(e){
        if(this.files && this.files[0]) {
		    updateImgBlob(this.files[0]);
        }
		e.stopPropagation();
	});

    // [수정됨] 드롭존 클릭 시 동작 (파일 추가 모드)
	document.querySelector("#dropzone").addEventListener("click", (e) => {
        // 버튼, 입력창, 삭제버튼 클릭 시 파일 선택창 뜨지 않게 방지
        if(e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || e.target.classList.contains('remove-btn')) return;
		document.querySelector("#fileform").click();
	});

    // [추가됨] 요구사항 5: 커버 영역 클릭 시 이미지 변경
	document.querySelector(".cover").addEventListener("click", (e) => {
		document.querySelector("#coverform").click();
		e.stopPropagation();
	});
	
    // [추가됨] 압축 버튼 이벤트 연결
    document.getElementById("btn-speed").addEventListener("click", (e) => {
        e.stopPropagation();
        runCompression("STORE"); // 속도 우선 (압축 안함)
    });
    document.getElementById("btn-size").addEventListener("click", (e) => {
        e.stopPropagation();
        runCompression("DEFLATE"); // 압축률 우선
    });

	updateImgBlob(img_blob);
});

function createDiv(innerText){
	let element = document.createElement("DIV");
	element.innerHTML = innerText;
	return element;
}

function updateImgBlob(blob){
	img_blob = blob;
	
	let reader = new FileReader();
	reader.onload = () => {
		document.querySelector("#cover-preview").setAttribute("src", reader.result);
	};
	reader.readAsDataURL(img_blob);
}

// [추가됨] 파일 목록 UI 렌더링 함수
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
            // 파일 경로가 있으면(폴더 내 파일) 경로 포함 표시
            let displayName = file.fullPath ? file.fullPath : file.name;
            li.innerHTML = `<span>${displayName}</span> <span class="remove-btn" onclick="removeFile(${index})">x</span>`;
            list.appendChild(li);
        });
    } else {
        container.style.display = "none";
        controls.style.display = "none";
    }
}

// [추가됨] 파일 추가 로직 (요구사항 2: 추가 모드)
function addFiles(fileList) {
    if(!fileList || fileList.length === 0) return;

    // 요구사항 3: 폴더 하나만 올리면 파일명 디폴트를 폴더명으로
    // 드래그앤드롭이 아닌 input으로 폴더 안 파일들을 선택했을 땐 감지 어려움. 
    // 드래그앤드롭 로직(scanFiles)에서 처리함. 여기는 일반 파일 추가.
    
    for(let i=0; i<fileList.length; i++){
        fileQueue.push(fileList[i]);
    }
    renderFileList();
}

// [추가됨] 파일 제거 함수 (요구사항 2)
window.removeFile = function(index) {
    fileQueue.splice(index, 1);
    renderFileList();
    event.stopPropagation();
}

// [추가됨] 압축 및 다운로드 실행 (요구사항 1, 4)
function runCompression(compressionMode) {
    if (fileQueue.length === 0) {
        alert("파일이 없습니다.");
        return;
    }

    log.clear();
    let zip = new JSZip();
    log.log("압축 준비 중...");

    // 파일 추가
    fileQueue.forEach(file => {
        // fullPath가 있으면(폴더 구조) 그대로 유지, 없으면 루트에 추가
        let path = file.fullPath ? file.fullPath : file.name;
        zip.file(path, file);
    });

    log.log("압축하는 중...");
    
    // 진행 바 시뮬레이션 인터벌
    let progressInterval = setInterval(() => {
        log.progress();
    }, 100);

    // 압축 옵션 설정
    let options = {
        type: "blob",
        compression: compressionMode, 
        compressionOptions: { level: compressionMode === "STORE" ? 1 : 6 }
    };

    zip.generateAsync(options).then((blob) => {
        clearInterval(progressInterval); // 진행 바 중지
        
        let fr = new FileReader();
        fr.onload = () => {
            let img_len = img_blob.size;
            let zipview = new DataView(fr.result);
            let len = zipview.byteLength;
            let eocd = len - 22;
            let cdr = zipview.getUint32(eocd + 16, true);
            zipview.setUint32(eocd + 16, cdr + img_len, true);
            
            while(cdr < eocd){
                let n = zipview.getUint16(cdr + 28, true);
                let m = zipview.getUint16(cdr + 30, true);
                let old_offset = zipview.getUint32(cdr + 42, true);
                zipview.setUint32(cdr + 42, old_offset + img_len, true);
                cdr += 46 + n + m;
            }
            
            let result_blob = new Blob([img_blob, zipview], {type: "image/png"});
            
            // 파일명 결정
            let filenameInput = document.getElementById("filename").value.trim();
            if(!filenameInput) filenameInput = "Result";
            
            saveAs(result_blob, filenameInput + ".png");
            log.log("완료!");
        };
        fr.readAsArrayBuffer(blob);
    }, null);
}

// [수정됨] 드래그앤드롭 처리 (요구사항 3: 폴더 지원)
window.addEventListener("dragover", function(e){
	e.preventDefault();
}, false);

window.addEventListener("drop", function(e){
	e.preventDefault();
	e.stopPropagation();
	
    // DataTransferItem API를 사용하여 폴더 처리 시도
    let items = e.dataTransfer.items;
    let filesToCheck = [];
    
    // 폴더 단일 업로드 체크용
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
            
            // 폴더 하나만 올렸으면 파일명 변경
            if(isSingleFolder && folderName) {
                document.getElementById("filename").value = folderName;
            }
            
            renderFileList();
        });
    } else {
        // 구형 브라우저 등 fallback
        addFiles(e.dataTransfer.files);
    }
}, false);

// [추가됨] 폴더 재귀 탐색 함수
function scanFiles(entries) {
    return new Promise(resolve => {
        let files = [];
        let len = entries.length;
        if (len === 0) { resolve(files); return; }

        let completed = 0;
        entries.forEach(entry => {
            if (entry.isFile) {
                entry.file(file => {
                    // entry.fullPath는 '/folder/file.txt' 형식이므로 앞의 / 제거
                    file.fullPath = entry.fullPath.substring(1); 
                    files.push(file);
                    completed++;
                    if (completed === len) resolve(files);
                });
            } else if (entry.isDirectory) {
                let dirReader = entry.createReader();
                dirReader.readEntries(subEntries => {
                    scanFiles(subEntries).then(subFiles => {
                        files = files.concat(subFiles);
                        completed++;
                        if (completed === len) resolve(files);
                    });
                });
            }
        });
    });
}
