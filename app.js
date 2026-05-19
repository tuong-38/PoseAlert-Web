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

// =========================================================================
// 2. KHỞI TẠO HỆ THỐNG AI & CAMERA (INIT)
// =========================================================================
async function init() {
    const modelURL = URL_MODEL + "model.json";
    const metadataURL = URL_MODEL + "metadata.json";

    try {
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

        console.log("Hệ thống PoseAlert đã sẵn sàng hoạt động!");
    } catch (error) {
        console.error("Lỗi nghiêm trọng khi khởi tạo luồng phần cứng:", error);
        document.getElementById("loading-model").innerText = "❌ Lỗi: Không thể kết nối Webcam hoặc tải mô hình!";
    }
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
    // Trích xuất tư thế dựa trên các điểm nút xương cơ thể
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

    // --- LOGIC BỘ LỌC THỜI GIAN LỌC NHIỄU SAI SỐ AI ---
    if (currentLabel === "Tư thế ngồi chuẩn") {
        // Nếu ngồi đúng: trừ dần điểm phạt, ẩn thông báo lỗi đỏ
        wrongPostureCounter = Math.max(0, wrongPostureCounter - 1);
        statusCard.style.backgroundColor = "#dcfce7"; // Đổi sang nền xanh mượt
        statusCard.style.color = "#15803d";
        alertBox.style.display = "none";
    } else if (confidence > 0.75) {
        // Nếu phát hiện ngồi sai tư thế bất kỳ với độ tự tin trên 75%
        wrongPostureCounter++;
        statusCard.style.backgroundColor = "#fee2e2"; // Đổi sang nền đỏ nhạt cảnh báo
        statusCard.style.color = "#b91c1c";

        // Nếu thời gian ngồi sai tích lũy vượt ngưỡng an toàn (3 giây liên tục)
        if (wrongPostureCounter >= ALERT_THRESHOLD_FRAMES) {
            alertBox.style.display = "block"; // Hiển thị khung cảnh báo chữ to
            
            // Cứ mỗi 30 frames tiếp theo (~1 giây) ngồi sai thì phát tiếng bíp nhắc nhở bằng loa laptop
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
        oscillator.frequency.value = frequency; // Tần số âm thanh (Hz)
        gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime); // Âm lượng giới hạn ở mức 10% tránh giật mình

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
        // NGẮT HOÀN TOÀN LUỒNG CAMERA
        isCameraActive = false;
        
        if (webcam && webcam.stream) {
            webcam.stop(); // Tắt thấu kính phần cứng (Đèn xanh cạnh webcam sẽ tắt hẳn)
        }
        if (animationFrameId) {
            window.cancelAnimationFrame(animationFrameId); // Hủy lịch trình lặp của trình duyệt
        }
        
        ctx.clearRect(0, 0, canvas.width, canvas.height); // Xóa vết ảnh cũ trên khung Canvas
        
        btn.innerText = "📷 Bắt đầu học (Bật camera)";
        btn.style.backgroundColor = "#16a34a"; // Đổi nút sang tông xanh lá
        statusText.innerText = "Hệ thống Camera đang tạm dừng.";
        document.getElementById("alert-box").style.display = "none";
        wrongPostureCounter = 0; // Reset điểm phạt lỗi tư thế
        
    } else {
        // KÍCH HOẠT LẠI LUỒNG CAMERA
        isCameraActive = true;
        btn.innerText = "🛑 Dừng camera (Dừng học)";
        btn.style.backgroundColor = "#dc2626"; // Đổi nút về tông đỏ mặc định
        statusText.innerText = "Đang kết nối lại webcam...";
        
        webcam.play(); // Mở lại luồng và tái kích hoạt hàm loop nhận diện
        animationFrameId = window.requestAnimationFrame(loop);
    }
}

// =========================================================================
// 7. ĐIỀU KHIỂN CHẾ ĐỘ POMODORO (TIMER POMODORO)
// =========================================================================
function togglePomodoro() {
    const btn = document.getElementById("btn-timer");
    const statusText = document.getElementById("pomodoro-status");

    if (isPomodoroRunning) {
        // Thực hiện lệnh Tạm dừng đồng hồ
        clearInterval(pomodoroTimer);
        isPomodoroRunning = false;
        btn.innerText = "▶️ Tiếp tục học";
        btn.style.backgroundColor = "#2563eb";
    } else {
        // Thực hiện lệnh Chạy tiếp đồng hồ
        isPomodoroRunning = true;
        btn.innerText = "⏸️ Tạm dừng";
        btn.style.backgroundColor = "#eab308"; // Chuyển nút sang màu vàng nhạt
        
        pomodoroTimer = setInterval(updatePomodoroClock, 1000); // Kích hoạt bộ đếm chạy chu kỳ 1 giây
    }
}

// Trừ thời gian và hoán đổi phiên Học/Nghỉ khi bộ đếm về 0
function updatePomodoroClock() {
    if (timeRemaining > 0) {
        timeRemaining--;
        displayTime();
    } else {
        clearInterval(pomodoroTimer);
        isPomodoroRunning = false;
        
        // Hết giờ: Phát chuông kép bằng âm tầng để báo hiệu cho sinh viên
        playAlertSound(440, 0.4);
        setTimeout(() => playAlertSound(880, 0.4), 500);

        if (pomodoroMode === "WORK") {
            // Chuyển từ trạng thái Học sang trạng thái Nghỉ giải lao 5 phút
            pomodoroMode = "BREAK";
            timeRemaining = 5 * 60; 
            document.getElementById("pomodoro-status").innerText = "🎉 Hết giờ học! Hãy nghỉ ngơi thư giãn 5 phút.";
            document.getElementById("pomodoro-status").style.color = "#16a34a";
            alert("Đã hoàn thành 25 phút tập trung cao độ! Hãy đứng dậy đi lại giải lao trong 5 phút nhé.");
        } else {
            // Chuyển từ trạng thái Nghỉ quay trở lại phiên Học 25 phút tập trung tiếp theo
            pomodoroMode = "WORK";
            timeRemaining = 25 * 60; 
            document.getElementById("pomodoro-status").innerText = "💻 Đến giờ tập trung học rồi!";
            document.getElementById("pomodoro-status").style.color = "#2563eb";
            alert("Hết thời gian nghỉ ngơi giải lao. Hãy ngồi ngay ngắn lại trước camera để tiếp tục học!");
        }

        const btn = document.getElementById("btn-timer");
        btn.innerText = "▶️ Bắt đầu phiên mới";
        btn.style.backgroundColor = "#2563eb";
        displayTime();
    }
}

// Quy đổi tổng số giây còn lại ra định dạng trực quan hiển thị lên màn hình (MM:SS)
function displayTime() {
    const minutes = Math.floor(timeRemaining / 60);
    const seconds = timeRemaining % 60;
    const formattedTime = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    document.getElementById("timer").innerText = formattedTime;
}

// Khôi phục đồng hồ Pomodoro về trạng thái mặc định ban đầu
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
    btn.style.backgroundColor = "#2563eb";
}

// Lắng nghe trình duyệt dựng xong cây cấu trúc phần tử (DOM) để tự động gọi hàm init khởi chạy AI
window.addEventListener("DOMContentLoaded", init);