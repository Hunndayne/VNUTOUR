# VnuTourBot 🤖

Bot Discord quản lý tour VNU với các chức năng âm nhạc và quản lý trạm.

## ✨ Tính năng

### 🎵 **Âm nhạc**
- Phát nhạc từ YouTube
- Queue nhạc với điều khiển
- Điều chỉnh âm lượng
- Hỗ trợ tìm kiếm và URL

### 🏁 **Quản lý Tour**
- 10 trạm tour với hệ thống check-in/check-out
- Quản lý đội tham gia
- Bảng xếp hạng thời gian
- Role tự động cho thành viên

### 🔧 **Admin & Moderation**
- Quản lý tin nhắn
- Kick/Ban thành viên
- Logging tự động
- Thống kê server

## 🚀 Cài đặt

### 1. Clone repository
```bash
git clone <repository-url>
cd VnuTourBot
```

### 2. Tạo môi trường ảo
```bash
python -m venv .venv
# Windows
.venv\Scripts\activate
# Linux/Mac
source .venv/bin/activate
```

### 3. Cài đặt dependencies
```bash
pip install -r requirements.txt
```

### 4. Cài đặt FFmpeg
- **Windows**: Tải từ [ffmpeg.org](https://ffmpeg.org/download.html)
- **Linux**: `sudo apt install ffmpeg`
- **Mac**: `brew install ffmpeg`

### 5. Tạo file .env
```env
DISCORD_TOKEN=your_bot_token_here
WELCOME_CHANNEL_ID=123456789
LOG_CHANNEL_ID=123456789
FFMPEG_EXE=ffmpeg
```

### 6. Chạy bot
```bash
python main.py
```

## 📋 Lệnh

### 🎵 Lệnh âm nhạc
- `!play <tên bài hát/URL>` - Phát nhạc
- `!skip` - Bỏ qua bài hát hiện tại
- `!queue` - Hiển thị queue nhạc
- `!stop` - Dừng phát nhạc
- `!volume <0-200>` - Điều chỉnh âm lượng (phần trăm, áp dụng ngay lập tức)
- `!exit` - Thoát khỏi voice channel

### 🏁 Lệnh tour
- `!stations` - Hiển thị danh sách trạm
- `!checkin <trạm_id> <tên đội>` - Check-in vào trạm
- `!checkout <tên đội>` - Check-out khỏi trạm
- `!mystation` - Hiển thị trạm hiện tại
- `!leaderboard` - Bảng xếp hạng

### 🔧 Lệnh admin
- `!ping` - Kiểm tra độ trễ
- `!info` - Thông tin bot
- `!clear <số>` - Xóa tin nhắn
- `!kick <@user> <lý do>` - Kick thành viên
- `!ban <@user> <lý do>` - Ban thành viên

## 🏗️ Cấu trúc dự án

```
VnuTourBot/
├── main.py                 # Entry point
├── requirements.txt        # Dependencies
├── .env                   # Environment variables
├── src/
│   ├── bot/              # Core bot functionality
│   │   ├── __init__.py
│   │   ├── bot.py        # Main bot class
│   │   ├── config.py     # Configuration
│   │   └── logger.py     # Logging system
│   ├── commands/         # Bot commands
│   │   ├── __init__.py
│   │   ├── music_commands.py
│   │   ├── admin_commands.py
│   │   └── tour_commands.py
│   ├── events/           # Event handlers
│   │   ├── __init__.py
│   │   ├── member_events.py
│   │   ├── message_events.py
│   │   └── reaction_events.py
│   ├── music/            # Music system
│   │   ├── __init__.py
│   │   ├── player.py     # Music player
│   │   ├── track.py      # Track class
│   │   └── ytdlp_handler.py
│   └── utils/            # Utilities
│       ├── __init__.py
│       ├── mongo.py      # MongoDB management
│       └── role_manager.py
```

## 🔧 Cấu hình

### Bot Permissions
Bot cần các quyền sau:
- Send Messages
- Manage Messages
- Kick Members
- Ban Members
- Connect (Voice)
- Speak (Voice)
- Use Slash Commands

### Intents
- Message Content Intent
- Server Members Intent
- Presence Intent

## 📝 Ghi chú

- Bot sử dụng MongoDB làm database chính
- Hỗ trợ tối đa 10 trạm tour
- Mỗi trạm chỉ có thể có 1 đội tại một thời điểm
- Âm nhạc sử dụng yt-dlp và FFmpeg
- Lệnh `!volume` sẽ áp dụng âm lượng ngay lập tức cho bài hiện tại
- Lệnh `!skip` sẽ tự động chuyển sang bài tiếp theo
- Volume được định dạng theo phần trăm (0-200%)

## 🤝 Đóng góp

1. Fork repository
2. Tạo feature branch
3. Commit changes
4. Push to branch
5. Tạo Pull Request

## 📄 License

MIT License - xem file LICENSE để biết thêm chi tiết.

## 🆘 Hỗ trợ

Nếu gặp vấn đề, hãy tạo issue trên GitHub hoặc liên hệ team phát triển.
