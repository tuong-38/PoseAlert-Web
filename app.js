// ==========================================
// 1. KHAI BÁO CÁC BIẾN TOÀN CỤC (GLOBAL VARIABLES)
// ==========================================
const URL_MODEL = "./model/"; // Đường dẫn đến thư mục chứa mô hình trong dự án

let model, webcam, ctx, maxPredictions;
let isCameraActive = true;     // Trạng thái hoạt động của camera
let animationFrameId = null;   // ID của vòng lặp requestAnimationFrame (dùng để hủy lặp khi tắt camera)

// Các biến phục vụ việc xử lý bộ lọc thời gian cảnh báo (Buffer)
let wrongPostureCounter = 0;
const ALERT_THRESHOLD_FRAMES = 90; // Khoảng 3 giây nếu camera chạy ~30fps

// ==========================================
// 2. HÀM KHỞI TẠO HỆ THỐNG (INIT)
// ==========================================
async function init() {
    const modelURL = URL_MODEL + "model.json";
    const metadataURL = URL_MODEL + "metadata.json";

    try {
        // Tải mô hình và thông tin metadata từ thư mục local
        model = await tmPose.load(modelURL, metadataURL);
        maxPredictions = model.getTotalClasses();

        // Ẩn dòng chữ "Đang tải mô hình" trên màn hình giao diện
        document.getElementById("loading-model").style.display = "none";

        // Thiết lập cấu hình ban đầu cho Webcam (Kích thước 400x400)
        const size = 400;
        const flip = true; // Lật ảnh đối xứng như soi gương
        webcam = new tmPose.Webcam(size, size, flip);
        
        await webcam.setup(); // Yêu cầu quyền truy cập Camera từ người dùng
        await webcam.play();  // Kích hoạt luồng video phát thời gian thực
        
        // Lưu ID của vòng lặp vào biến animationFrameId để có thể hủy sau này
        animationFrameId = window.requestAnimationFrame(loop);

        // Chuẩn bị khung Canvas để vẽ hình ảnh từ webcam lên giao diện web
        const canvas = document.getElementById("canvas");
        canvas.width = size;
        canvas.height = size;
        ctx = canvas.getContext("2d");

        console.log("Hệ thống PoseAlert đã sẵn sàng!");
    } catch (error) {
        console.error("Lỗi khi khởi tạo hệ thống:", error);
        document.getElementById("loading-model").innerText = "❌ Lỗi: Không thể tải mô hình hoặc camera!";
    }
}

// ==========================================
// 3. VÒNG LẶP CẬP NHẬT KHUNG HÌNH (ANIMATION LOOP)
// ==========================================
async function loop(timestamp) {
    if (!isCameraActive) return; // Nếu camera đã bị ngắt (bấm nút Dừng), thoát ngay lập tức

    webcam.update(); // Cập nhật hình ảnh mới nhất từ mắt camera
    await predict(); // Thực hiện đưa hình ảnh vào mô hình AI để nhận diện
    
    // Tiếp tục gọi vòng lặp ở khung hình kế tiếp
    animationFrameId = window.requestAnimationFrame(loop);
}

// ==========================================
// 4. LOGIC NHẬN DIỆN VÀ XỬ LÝ CẢNH BÁO (PREDICT)
// ==========================================
async function predict() {
    // Thực hiện dự đoán tư thế dựa trên thuật toán trích xuất xương PoseNet của Teachable Machine
    const { pose, posenetOutput } = await model.estimatePose(webcam.canvas);
    const prediction = await model.predict(posenetOutput);

    // Vẽ hình ảnh hiện tại của Webcam lên khung Canvas
    ctx.drawImage(webcam.canvas, 0, 0);

    // Thuật toán Argmax: Tìm nhãn tư thế có xác suất phần trăm cao nhất
    let highestPrediction = prediction[0];
    for (let i = 1; i < maxPredictions; i++) {
        if (prediction[i].probability > highestPrediction.probability) {
            highestPrediction = prediction[i];
        }
    }

    const currentLabel = highestPrediction.className;
    const confidence = highestPrediction.probability;

    // Lấy các thẻ HTML để chuẩn bị cập nhật UI/UX
    const statusCard = document.getElementById("status-card");
    const statusText = document.getElementById("status-text");
    const alertBox = document.getElementById("alert-box");

    // Hiển thị tên nhãn kèm độ tự tin lên màn hình
    statusText.innerText = `Trạng thái: ${currentLabel} (${(confidence * 100).toFixed(1)}%)`;

    // Bộ lọc khử nhiễu tư thế (Time Buffer Logic)
    if (currentLabel === "Tư thế ngồi chuẩn") {
        // Nếu người dùng ngồi chuẩn: giảm dần bộ đếm phạt, chuyển màu thẻ sang xanh
        wrongPostureCounter = Math.max(0, wrongPostureCounter - 1);
        statusCard.className = "status-good";
        alertBox.classList.add("hidden");
    } else if (confidence > 0.75) {
        // Nếu người dùng ngồi sai (với độ tự tin > 75%)
        wrongPostureCounter++;
        statusCard.className = "status-bad";

        // Nếu tư thế sai này kéo dài liên tục vượt ngưỡng thời gian (khoảng 3 giây)
        if (wrongPostureCounter >= ALERT_THRESHOLD_FRAMES) {
            alertBox.classList.remove("hidden");
            
            // Phân biệt chi tiết từng loại tư thế sai dựa trên nhãn tiếng Việt của bạn để đưa ra nhắc nhở
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

// ==========================================
// 5. LOGIC ĐIỀU KHIỂN BẬT / TẮT CAMERA (TOGGLE)
// ==========================================
function toggleCamera() {
    const btn = document.getElementById("btn-camera");
    const statusText = document.getElementById("status-text");
    const canvas = document.getElementById("canvas");

    if (isCameraActive) {
        // --- THỰC HIỆN DỪNG CAMERA ---
        isCameraActive = false;
        
        // 1. Tắt luồng vật lý của camera thiết bị (đèn LED cạnh webcam sẽ tắt hẳn)
        if (webcam && webcam.stream) {
            webcam.stop(); 
        }
        
        // 2. Hủy lịch trình vẽ khung hình của trình duyệt
        if (animationFrameId) {
            window.cancelAnimationFrame(animationFrameId);
        }
        
        // 3. Xóa sạch hình ảnh cũ còn lưu lại trên khung Canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // 4. Thay đổi trạng thái giao diện nút bấm
        btn.innerText = "📷 Bắt đầu học (Bật camera)";
        btn.style.backgroundColor = "#16a34a"; // Đổi nút sang màu xanh lá cây
        statusText.innerText = "Hệ thống đang tạm dừng.";
        document.getElementById("alert-box").classList.add("hidden");
        
        wrongPostureCounter = 0; // Khởi động lại bộ đếm phạt về 0
        
    } else {
        // --- THỰC HIỆN KÍCH HOẠT LẠI CAMERA ---
        isCameraActive = true;
        
        btn.innerText = "🛑 Dừng camera (Dừng học)";
        btn.style.backgroundColor = "#dc2626"; // Đổi nút về lại màu đỏ mặc định
        statusText.innerText = "Đang khởi động lại camera...";
        
        // Gọi lại luồng ghi nhận webcam và kích hoạt lại hàm loop
        webcam.play();
        animationFrameId = window.requestAnimationFrame(loop);
    }
}

// Lắng nghe sự kiện trang web tải xong toàn bộ cấu trúc DOM để kích hoạt hàm init()
window.addEventListener("DOMContentLoaded", init);