// =========================================================================
// 1. CẤU HÌNH BIẾN TOÀN CỤC (GLOBAL VARIABLES)
// =========================================================================
const URL_MODEL = "./model/"; // Đường dẫn local tới thư mục chứa mô hình AI

let model, webcam, ctx, maxPredictions;
let isCameraActive = true;     // Trạng thái Bật/Tắt của Webcam
let animationFrameId = null;   // Quản lý ID vòng lặp render hình ảnh

// Biến kiểm soát bộ lọc thời gian để tránh cảnh báo ảo (Time Buffer)
let wrongPostureCounter = 0;
const ALERT_THRESHOLD_FRAMES = 90; // Yêu cầu ngồi sai liên tục ~3 giây (ở mức 30fps) mới phạt

// Biến quản lý chế độ đếm ngược tập trung Pomodoro
let pomodoroTimer = null;
let timeRemaining = 25 * 60;   // Mặc định 25 phút quy đổi thành giây
let isPomodoroRunning = false; // Trạng thái đang chạy/tạm dừng của đồng hồ
let pomodoroMode = "WORK";     // Có 2 chế độ: "WORK" (Đang học) hoặc "BREAK" (Đang nghỉ)

// --- CẤU HÌNH BIẾN THỐNG KÊ & BIỂU ĐỒ (CHART.JS) ---
let postureChart = null;
// Bộ đếm số khung hình (frames) của từng tư thế để tính tỷ lệ phần trăm
const postureCounts = {
    "Tư thế ngồi chuẩn": 0,
    "Gù lưng, cúi đầu": 0,
    "Vẹo người": 0,
    "Nhìn quá gần màn hình": 0
};

// =========================================================================
// 2. KHỞI TẠO HỆ THỐNG AI, CAMERA & BIỂU ĐỒ (INIT)
// =========================================================================
async function init() {
    const modelURL = URL_MODEL + "model.json";
    const metadataURL = URL_MODEL + "metadata.json";

    try {
        // Khởi tạo Biểu đồ Chart.js trước
        initChart();

        // Tải cấu trúc mạng và tệp nhãn phân loại từ thư mục local
        model = await tmPose.load(modelURL, metadataURL);
        maxPredictions = model.getTotalClasses();

        // Ẩn thông báo "Đang tải" khi mô hình nạp thành công vào RAM
        document.getElementById("loading-model").style.display = "none";

        // Thiết lập kích thước luồng thu hình Webcam
        const size = 400;
        const flip = true; // Lật ngược chiều ngang để hiển thị dạng soi gương trực quan
        webcam = new tmPose.Webcam(size, size, flip);
        
        await webcam.setup(); // Trình duyệt kích hoạt bảng xin quyền Camera người dùng
        await webcam.play();  // Bắt đầu truyền dữ liệu hình ảnh trực tiếp
        
        // Kích hoạt vòng lặp vẽ khung hình và lưu lại ID điều khiển
        animationFrameId = window.requestAnimationFrame(loop);

        // Liên kết với thẻ Canvas để render luồng Webcam lên màn hình HTML
        const canvas = document.getElementById("canvas");
        canvas.width = size;
        canvas.height = size;
        ctx = canvas.getContext("2d");

        console.log("Hệ thống PoseAlert và Biểu đồ đã sẵn sàng hoạt động!");
    } catch (error) {
        console.error("Lỗi nghiêm trọng khi khởi tạo luồng phần cứng:", error);
        document.getElementById("loading-model").innerText = "❌ Lỗi: Không thể kết nối Webcam hoặc tải mô hình!";
    }
}

// Hàm khởi tạo cấu hình biểu đồ tròn Chart.js ban đầu
function initChart() {
    const ctxChart = document.getElementById('postureChart').getContext('2d');
    postureChart = new Chart(ctxChart, {
        type: 'pie', // Loại biểu đồ tròn (Bánh)
        data: {
            labels: Object.keys(postureCounts),
            datasets: [{
                data: Object.values(postureCounts),
                backgroundColor: [
                    '#16a34a', // Xanh lá - Ngồi chuẩn
                    '#ea580c', // Cam - Gù lưng
                    '#8b5cf6', // Tím - Vẹo người
                    '#dc2626'  // Đỏ - Nhìn quá gần
                ],
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false // Ẩn nhãn chữ chú thích gốc để tiết kiệm không gian
                }
            }
        }
    });
}

// =========================================================================
// 3. VÒNG LẶP RENDER KHUNG HÌNH LIÊN TỤC (ANIMATION LOOP)
// =========================================================================
async function loop(timestamp) {
    if (!isCameraActive) return; // Nếu trạng thái camera tắt, lập tức bẻ gãy vòng lặp

    webcam.update(); // Nạp frame hình ảnh mới nhất từ ống kính camera
    await predict(); // Đẩy dữ liệu sang mô hình TensorFlow để tính toán dự đoán
    
    // Gối đầu tiếp tục gọi vòng lặp vẽ ở frame tiếp theo
    animationFrameId = window.requestAnimationFrame(loop);
}

// =========================================================================
// 4. KIỂM TRA PHÂN LOẠI TƯ THẾ & PHÁT CẢNH BÁO (PREDICT)
// =========================================================================
async function predict() {
    const { pose, posenetOutput } = await model.estimatePose(webcam.canvas);
    const prediction = await model.predict(posenetOutput);

    // Vẽ trực tiếp ma trận điểm ảnh webcam lên màn hình canvas giao diện
    ctx.drawImage(webcam.canvas, 0, 0);

    // Tìm kiếm vị trí nhãn (Class) có xác suất dự đoán lớn nhất (Thuật toán Argmax)
    let highestPrediction = prediction[0];
    for (let i = 1; i < maxPredictions; i++) {
        if (prediction[i].probability > highestPrediction.probability) {
            highestPrediction = prediction[i];
        }
    }

    const currentLabel = highestPrediction.className;
    const confidence = highestPrediction.probability;

    // Lấy các phần tử DOM trên trang web để chuẩn bị thay đổi trạng thái
    const statusCard = document.getElementById("status-card");
    const statusText = document.getElementById("status-text");
    const alertBox = document.getElementById("alert-box");

    // In nhãn tư thế hiện tại cùng độ chính xác lên màn hình
    statusText.innerText = `Trạng thái: ${currentLabel} (${(confidence * 100).toFixed(1)}%)`;

    // --- TÍCH LŨY SỐ LIỆU CHO BIỂU ĐỒ (Chỉ cộng khi độ tự tin > 60%) ---
    if (confidence > 0.60 && postureCounts[currentLabel] !== undefined) {
        postureCounts[currentLabel]++;
        
        // Cứ mỗi 15 frames (~0.5 giây), cập nhật làm mới lại biểu đồ một lần để tránh lag
        if (wrongPostureCounter % 15 === 0) {
            postureChart.data.datasets[0].data = Object.values(postureCounts);
            postureChart.update('none'); // Khởi chạy update chế độ tĩnh để tối ưu hiệu năng
        }
    }

    // --- LOGIC BỘ LỌC THỜI GIAN LỌC NHIỄU SAI SỐ AI ---
    if (currentLabel === "Tư thế ngồi chuẩn") {
        wrongPostureCounter = Math.max(0, wrongPostureCounter - 1);
        statusCard.className = "status-card status-good";
        alertBox.style.display = "none";
    } else if (confidence > 0.75) {
        wrongPostureCounter++;
        statusCard.className = "status-card status-bad";

        // Nếu thời gian ngồi sai tích lũy vượt ngưỡng an toàn (3 giây liên tục)
        if (wrongPostureCounter >= ALERT_THRESHOLD_FRAMES) {
            alertBox.style.display = "block"; // Hiển thị khung cảnh báo chữ to
            
            // Cứ mỗi 30 frames tiếp theo (~1 giây) ngồi sai thì phát tiếng bíp nhắc nhở
            if (wrongPostureCounter % 30 === 0) {
                playAlertSound(700, 0.15); 
            }

            // Định tuyến thông điệp thông minh dựa trên chính xác nhãn tiếng Việt của bạn
            if (currentLabel === "Gù lưng, cúi đầu") {
                alertBox.innerText = "🚨 CẢNH BÁO: BẠN ĐANG GÙ LƯNG! HÃY NGỒI THẲNG LÊN!";
            } else if (currentLabel === "Vẹo người") {
                alertBox.innerText = "🚨 CẢNH BÁO: BẠN ĐANG NGỒI VẸO NGƯỜI! HÃY CÂN BẰNG LẠI VAI!";
            } else if (currentLabel === "Nhìn quá gần màn hình") {
                alertBox.innerText = "🚨 CẢNH BÁO: MẮT QUÁ GẦN MÀN HÌNH! HÃY NGỒI LÙI LẠI ĐỂ BẢO VỆ MẮT!";
            }
        }
    }
}

// =========================================================================
// 5. CƠ CHẾ SÓNG ÂM PHÁT RA TIẾNG BÍP CẢNH BÁO (AUDIO API)
// =========================================================================
function playAlertSound(frequency = 600, duration = 0.2) {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();

        oscillator.type = "sine"; 
        oscillator.frequency.value = frequency; 
        gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime); 

        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        oscillator.start();
        oscillator.stop(audioCtx.currentTime + duration);
    } catch (e) {
        console.warn("Trình duyệt chặn quyền tự động phát âm thanh:", e);
    }
}

// =========================================================================
// 6. ĐIỀU KHIỂN NÚT BẬT / TẮT CAMERA VẬT LÝ (TOGGLE CAMERA)
// =========================================================================
function toggleCamera() {
    const btn = document.getElementById("btn-camera");
    const statusText = document.getElementById("status-text");
    const canvas = document.getElementById("canvas");

    if (isCameraActive) {
        isCameraActive = false;
        if (webcam && webcam.stream) { webcam.stop(); }
        if (animationFrameId) { window.cancelAnimationFrame(animationFrameId); }
        ctx.clearRect(0, 0, canvas.width, canvas.height); 
        
        btn.innerText = "📷 Bắt đầu học (Bật camera)";
        btn.className = "btn btn-success";
        statusText.innerText = "Hệ thống Camera đang tạm dừng.";
        document.getElementById("alert-box").style.display = "none";
        wrongPostureCounter = 0; 
    } else {
        isCameraActive = true;
        btn.innerText = "🛑 Dừng camera (Dừng học)";
        btn.className = "btn btn-danger";
        statusText.innerText = "Đang kết nối lại webcam...";
        
        webcam.play(); 
        animationFrameId = window.requestAnimationFrame(loop);
    }
}

// =========================================================================
// 7. ĐIỀU KHIỂN CHẾ ĐỘ POMODORO (TIMER POMODORO)
// =========================================================================
function togglePomodoro() {
    const btn = document.getElementById("btn-timer");

    if (isPomodoroRunning) {
        clearInterval(pomodoroTimer);
        isPomodoroRunning = false;
        btn.innerText = "▶️ Tiếp tục học";
        btn.className = "btn btn-primary";
    } else {
        isPomodoroRunning = true;
        btn.innerText = "⏸️ Tạm dừng";
        btn.className = "btn btn-secondary"; // Đổi style màu khi bấm chạy
        
        pomodoroTimer = setInterval(updatePomodoroClock, 1000); 
    }
}

function updatePomodoroClock() {
    if (timeRemaining > 0) {
        timeRemaining--;
        displayTime();
    } else {
        clearInterval(pomodoroTimer);
        isPomodoroRunning = false;
        
        playAlertSound(440, 0.4);
        setTimeout(() => playAlertSound(880, 0.4), 500);

        if (pomodoroMode === "WORK") {
            pomodoroMode = "BREAK";
            timeRemaining = 5 * 60; 
            document.getElementById("pomodoro-status").innerText = "🎉 Hết giờ học! Hãy nghỉ ngơi thư giãn 5 phút.";
            document.getElementById("pomodoro-status").style.color = "#16a34a";
            alert("Đã hoàn thành 25 phút tập trung cao độ! Hãy đứng dậy đi lại giải lao trong 5 phút nhé.");
        } else {
            pomodoroMode = "WORK";
            timeRemaining = 25 * 60; 
            document.getElementById("pomodoro-status").innerText = "💻 Đến giờ tập trung học rồi!";
            document.getElementById("pomodoro-status").style.color = "#2563eb";
            alert("Hết thời gian nghỉ ngơi giải lao. Hãy ngồi ngay ngắn lại trước camera để tiếp tục học!");
        }

        const btn = document.getElementById("btn-timer");
        btn.innerText = "▶️ Bắt đầu phiên mới";
        btn.className = "btn btn-primary";
        displayTime();
    }
}

function displayTime() {
    const minutes = Math.floor(timeRemaining / 60);
    const seconds = timeRemaining % 60;
    document.getElementById("timer").innerText = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function resetPomodoro() {
    clearInterval(pomodoroTimer);
    isPomodoroRunning = false;
    pomodoroMode = "WORK";
    timeRemaining = 25 * 60;
    
    document.getElementById("timer").innerText = "25:00";
    document.getElementById("pomodoro-status").innerText = "Trạng thái: Sẵn sàng học";
    document.getElementById("pomodoro-status").style.color = "#2563eb";
    
    const btn = document.getElementById("btn-timer");
    btn.innerText = "▶️ Bắt đầu học";
    btn.className = "btn btn-primary";

    // Tiến hành reset luôn cả số liệu biểu đồ thống kê về 0 (Tùy chọn hữu ích)
    for (let key in postureCounts) { postureCounts[key] = 0; }
    postureChart.data.datasets[0].data = Object.values(postureCounts);
    postureChart.update();
}

// Tự động kích hoạt
window.addEventListener("DOMContentLoaded", init);