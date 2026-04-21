import os
import re

# 1. Read base64 from old file
with open('summer-camp-timetable.html', 'r', encoding='utf-8') as f:
    tt_content = f.read()
    
match = re.search(r'data:image/png;base64,[A-Za-z0-9+/=]+', tt_content)
base64_logo = match.group(0)

# 2. Write User provided HTML (which lacks the logo code and properly sized html2pdf code)
user_html = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Happy English Club - Bilingual Timetable (Grades 1-2)</title>
<script src="https://cdn.tailwindcss.com"></script>
<!-- html2pdf library for PDF generation -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap');
body { font-family: 'Inter', sans-serif; }
.cell-hover:hover { transform: scale(1.02); transition: transform 0.2s ease-in-out; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); z-index: 10; position: relative; }
</style>
</head>
<body class="bg-gray-100 p-4 md:p-8">

<div id="timetable-content" class="max-w-7xl mx-auto bg-white rounded-2xl shadow-xl overflow-hidden border-t-8 border-purple-800 relative">
    
    <!-- Controls (Not printed in PDF) -->
    <div id="controls-bar" class="absolute top-4 right-4 z-20 flex gap-2">
        <button onclick="downloadPDF()" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-full shadow-md transition-colors text-sm flex items-center">
            <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
            Download PDF
        </button>
        <button id="lang-btn" onclick="toggleLanguage()" class="bg-yellow-400 hover:bg-yellow-500 text-purple-900 font-bold py-2 px-4 rounded-full shadow-md transition-colors text-sm flex items-center">
            <img src="https://flagcdn.com/w20/vn.png" width="20" class="inline-block mr-2" alt="VN"> Tiếng Việt
        </button>
    </div>

    <!-- Header -->
    <div class="bg-purple-800 text-white p-8 md:p-12 text-center relative overflow-hidden flex flex-col items-center">
        <img src="LOGO_PLACEHOLDER" alt="Happy English Club Logo" class="h-20 md:h-24 object-contain mb-4">
        <h1 class="lang-text text-4xl md:text-5xl font-extrabold mb-4 text-yellow-400 tracking-tight uppercase" 
            data-en="Little Explorers Camp" 
            data-vi="Trại Hè Khám Phá Nhí">Little Explorers Camp</h1>
        <p class="lang-text text-xl md:text-2xl font-semibold mb-6 max-w-4xl mx-auto leading-relaxed"
            data-en="A fun, safe, and engaging summer for Grades 1 & 2. Learning through play!"
            data-vi="Mùa hè vui vẻ, an toàn và thú vị cho Lớp 1 & 2. Học hỏi thông qua vui chơi!">
            A fun, safe, and engaging summer for Grades 1 & 2. Learning through play!
        </p>
        <div class="flex flex-wrap justify-center gap-4 text-sm md:text-base font-medium">
            <span class="lang-text bg-purple-900 px-4 py-2 rounded-full border border-purple-700" data-en="🎨 Creative Play" data-vi="🎨 Vui chơi Sáng tạo">🎨 Creative Play</span>
            <span class="lang-text bg-purple-900 px-4 py-2 rounded-full border border-purple-700" data-en="🤖 Fun with Tech" data-vi="🤖 Làm quen Công nghệ">🤖 Fun with Tech</span>
            <span class="lang-text bg-purple-900 px-4 py-2 rounded-full border border-purple-700" data-en="🌟 English Confidence" data-vi="🌟 Tự tin Tiếng Anh">🌟 English Confidence</span>
        </div>
    </div>

    <!-- Table -->
    <div class="p-4 md:p-8 overflow-x-auto">
        <table class="w-full text-left border-collapse min-w-[1000px]">
            <thead>
                <tr>
                    <th class="lang-text w-1/12 p-4 bg-gray-50 text-purple-900 font-bold border-b-2 border-purple-200 uppercase tracking-wider text-sm text-center" data-en="Time" data-vi="Thời gian">Time</th>
                    <th class="lang-text w-1/6 p-4 bg-purple-50 text-purple-900 font-bold border-b-2 border-purple-200 text-center rounded-tl-lg" data-en="Monday<br><span class='text-xs font-normal text-purple-700'>Story Magic</span>" data-vi="Thứ 2<br><span class='text-xs font-normal text-purple-700'>Phép màu Câu chuyện</span>">Monday<br><span class="text-xs font-normal text-purple-700">Story Magic</span></th>
                    <th class="lang-text w-1/6 p-4 bg-purple-50 text-purple-900 font-bold border-b-2 border-purple-200 text-center" data-en="Tuesday<br><span class='text-xs font-normal text-purple-700'>Tinker Time</span>" data-vi="Thứ 3<br><span class='text-xs font-normal text-purple-700'>Giờ Chế tạo</span>">Tuesday<br><span class="text-xs font-normal text-purple-700">Tinker Time</span></th>
                    <th class="lang-text w-1/6 p-4 bg-purple-50 text-purple-900 font-bold border-b-2 border-purple-200 text-center" data-en="Wednesday<br><span class='text-xs font-normal text-purple-700'>World Friends</span>" data-vi="Thứ 4<br><span class='text-xs font-normal text-purple-700'>Bạn bè Năm châu</span>">Wednesday<br><span class="text-xs font-normal text-purple-700">World Friends</span></th>
                    <th class="lang-text w-1/6 p-4 bg-purple-50 text-purple-900 font-bold border-b-2 border-purple-200 text-center" data-en="Thursday<br><span class='text-xs font-normal text-purple-700'>Show & Tell</span>" data-vi="Thứ 5<br><span class='text-xs font-normal text-purple-700'>Trình bày & Chia sẻ</span>">Thursday<br><span class="text-xs font-normal text-purple-700">Show & Tell</span></th>
                    <th class="lang-text w-1/6 p-4 bg-yellow-50 text-purple-900 font-bold border-b-2 border-yellow-300 text-center rounded-tr-lg" data-en="Friday<br><span class='text-xs font-normal text-purple-700'>Little Stars</span>" data-vi="Thứ 6<br><span class='text-xs font-normal text-purple-700'>Sao Nhí Tỏa sáng</span>">Friday<br><span class="text-xs font-normal text-purple-700">Little Stars</span></th>
                </tr>
            </thead>
            <tbody class="text-sm">
                
                <tr>
                    <td class="p-3 border-b border-gray-100 font-bold text-gray-600 text-center whitespace-nowrap bg-gray-50">08:00 - 08:15</td>
                    <td colspan="5" class="p-3 border-b border-gray-100 bg-emerald-50 cell-hover">
                        <div class="flex items-center justify-center">
                            <span class="text-xl mr-2">🧘</span>
                            <div class="text-center lang-text" 
                                data-en="<span class='font-bold text-emerald-800'>Morning Calm & Feelings Check</span><br><span class='text-xs text-emerald-600'>Fun stretching and sharing how we feel today.</span>"
                                data-vi="<span class='font-bold text-emerald-800'>Chào buổi sáng & Khám phá Cảm xúc</span><br><span class='text-xs text-emerald-600'>Cùng vươn vai và chia sẻ cảm xúc ngày mới.</span>">
                                <span class="font-bold text-emerald-800">Morning Calm & Feelings Check</span><br><span class="text-xs text-emerald-600">Fun stretching and sharing how we feel today.</span>
                            </div>
                        </div>
                    </td>
                </tr>

                <tr>
                    <td class="p-3 border-b border-gray-100 font-bold text-gray-600 text-center whitespace-nowrap bg-gray-50">08:15 - 10:00</td>
                    <td class="p-3 border-b border-gray-100 bg-blue-50 border-r border-white cell-hover lang-text"
                        data-en="<span class='text-lg'>🗣️</span> <span class='font-bold text-blue-800'>Story Time Magic</span><br><span class='text-xs text-blue-600'>Listening to big ideas in English.</span>"
                        data-vi="<span class='text-lg'>🗣️</span> <span class='font-bold text-blue-800'>Phép màu Câu chuyện</span><br><span class='text-xs text-blue-600'>Lắng nghe những ý tưởng hay bằng Tiếng Anh.</span>">
                        <span class="text-lg">🗣️</span> <span class="font-bold text-blue-800">Story Time Magic</span><br><span class="text-xs text-blue-600">Listening to big ideas in English.</span>
                    </td>
                    <td class="p-3 border-b border-gray-100 bg-blue-50 border-r border-white cell-hover lang-text"
                        data-en="<span class='text-lg'>🎭</span> <span class='font-bold text-blue-800'>Role-Play Fun</span><br><span class='text-xs text-blue-600'>Acting out characters and learning words.</span>"
                        data-vi="<span class='text-lg'>🎭</span> <span class='font-bold text-blue-800'>Vui Đóng vai</span><br><span class='text-xs text-blue-600'>Hóa thân thành nhân vật và học từ mới.</span>">
                        <span class="text-lg">🎭</span> <span class="font-bold text-blue-800">Role-Play Fun</span><br><span class="text-xs text-blue-600">Acting out characters and learning words.</span>
                    </td>
                    <td class="p-3 border-b border-gray-100 bg-blue-50 border-r border-white cell-hover lang-text"
                        data-en="<span class='text-lg'>📖</span> <span class='font-bold text-blue-800'>Picture Book Adventures</span><br><span class='text-xs text-blue-600'>Reading fun stories together.</span>"
                        data-vi="<span class='text-lg'>📖</span> <span class='font-bold text-blue-800'>Phiêu lưu qua Sách ảnh</span><br><span class='text-xs text-blue-600'>Cùng nhau đọc những câu chuyện thú vị.</span>">
                        <span class="text-lg">📖</span> <span class="font-bold text-blue-800">Picture Book Adventures</span><br><span class="text-xs text-blue-600">Reading fun stories together.</span>
                    </td>
                    <td class="p-3 border-b border-gray-100 bg-blue-50 border-r border-white cell-hover lang-text"
                        data-en="<span class='text-lg'>⚖️</span> <span class='font-bold text-blue-800'>Share Your Thoughts</span><br><span class='text-xs text-blue-600'>Practicing speaking loudly and clearly.</span>"
                        data-vi="<span class='text-lg'>⚖️</span> <span class='font-bold text-blue-800'>Chia sẻ Cảm nghĩ</span><br><span class='text-xs text-blue-600'>Tập nói to, rõ ràng và tự tin.</span>">
                        <span class="text-lg">⚖️</span> <span class="font-bold text-blue-800">Share Your Thoughts</span><br><span class="text-xs text-blue-600">Practicing speaking loudly and clearly.</span>
                    </td>
                    <td class="p-3 border-b border-gray-100 bg-yellow-50 cell-hover lang-text"
                        data-en="<span class='text-lg'>🏆</span> <span class='font-bold text-yellow-800'>Star Speakers</span><br><span class='text-xs text-yellow-600'>Telling our friends what we learned.</span>"
                        data-vi="<span class='text-lg'>🏆</span> <span class='font-bold text-yellow-800'>Ngôi sao Hùng biện</span><br><span class='text-xs text-yellow-600'>Kể cho các bạn nghe những gì mình học được.</span>">
                        <span class="text-lg">🏆</span> <span class="font-bold text-yellow-800">Star Speakers</span><br><span class="text-xs text-yellow-600">Telling our friends what we learned.</span>
                    </td>
                </tr>

                <tr>
                    <td class="p-2 border-b border-gray-100 font-bold text-gray-400 text-center text-xs bg-gray-50">10:00 - 10:10</td>
                    <td colspan="5" class="lang-text p-2 border-b border-gray-100 bg-gray-100 text-center text-gray-500 text-xs uppercase font-bold tracking-wider"
                        data-en="Break" data-vi="Giải lao">
                        Break
                    </td>
                </tr>

                <tr>
                    <td class="p-3 border-b border-gray-100 font-bold text-gray-600 text-center whitespace-nowrap bg-gray-50">10:10 - 11:00</td>
                    <td class="p-3 border-b border-gray-100 bg-orange-50 border-r border-white cell-hover lang-text"
                        data-en="<span class='text-lg'>📐</span> <span class='font-bold text-orange-800'>LEGO Builders</span><br><span class='text-xs text-orange-600'>Designing fun houses and cars.</span>"
                        data-vi="<span class='text-lg'>📐</span> <span class='font-bold text-orange-800'>Kỹ sư LEGO</span><br><span class='text-xs text-orange-600'>Thiết kế nhà và xe đồ chơi thật vui.</span>">
                        <span class="text-lg">📐</span> <span class="font-bold text-orange-800">LEGO Builders</span><br><span class="text-xs text-orange-600">Designing fun houses and cars.</span>
                    </td>
                    <td class="p-3 border-b border-gray-100 bg-orange-50 border-r border-white cell-hover lang-text"
                        data-en="<span class='text-lg'>🤖</span> <span class='font-bold text-orange-800'>Fun with Robots</span><br><span class='text-xs text-orange-600'>Playing with safe Bee-Bots!</span>"
                        data-vi="<span class='text-lg'>🤖</span> <span class='font-bold text-orange-800'>Vui cùng Robot</span><br><span class='text-xs text-orange-600'>Làm quen với robot Bee-Bot an toàn!</span>">
                        <span class="text-lg">🤖</span> <span class="font-bold text-orange-800">Fun with Robots</span><br><span class="text-xs text-orange-600">Playing with safe Bee-Bots!</span>
                    </td>
                    <td class="p-3 border-b border-gray-100 bg-orange-50 border-r border-white cell-hover lang-text"
                        data-en="<span class='text-lg'>🛠️</span> <span class='font-bold text-orange-800'>Crafty Creators</span><br><span class='text-xs text-orange-600'>Making cool toys from paper and boxes.</span>"
                        data-vi="<span class='text-lg'>🛠️</span> <span class='font-bold text-orange-800'>Thợ thủ công Nhí</span><br><span class='text-xs text-orange-600'>Làm đồ chơi hay ho từ hộp giấy.</span>">
                        <span class="text-lg">🛠️</span> <span class="font-bold text-orange-800">Crafty Creators</span><br><span class="text-xs text-orange-600">Making cool toys from paper and boxes.</span>
                    </td>
                    <td class="p-3 border-b border-gray-100 bg-orange-50 border-r border-white cell-hover lang-text"
                        data-en="<span class='text-lg'>🔧</span> <span class='font-bold text-orange-800'>Toy Fixers</span><br><span class='text-xs text-orange-600'>Fixing our builds to make them stronger.</span>"
                        data-vi="<span class='text-lg'>🔧</span> <span class='font-bold text-orange-800'>Sửa chữa Đồ chơi</span><br><span class='text-xs text-orange-600'>Gia cố đồ chơi để chúng chắc chắn hơn.</span>">
                        <span class="text-lg">🔧</span> <span class="font-bold text-orange-800">Toy Fixers</span><br><span class="text-xs text-orange-600">Fixing our builds to make them stronger.</span>
                    </td>
                    <td class="p-3 border-b border-gray-100 bg-orange-50 border-r border-white cell-hover lang-text"
                        data-en="<span class='text-lg'>🚀</span> <span class='font-bold text-orange-800'>Big Build Challenge</span><br><span class='text-xs text-orange-600'>Showing off our awesome toys!</span>"
                        data-vi="<span class='text-lg'>🚀</span> <span class='font-bold text-orange-800'>Thử thách Lắp ráp</span><br><span class='text-xs text-orange-600'>Khoe đồ chơi tuyệt đỉnh của mình!</span>">
                        <span class="text-lg">🚀</span> <span class="font-bold text-orange-800">Big Build Challenge</span><br><span class="text-xs text-orange-600">Showing off our awesome toys!</span>
                    </td>
                </tr>

                <tr>
                    <td class="p-3 border-b border-gray-100 font-bold text-gray-600 text-center whitespace-nowrap bg-gray-50">11:00 - 14:00</td>
                    <td colspan="5" class="p-3 border-b border-gray-100 bg-emerald-50 cell-hover">
                        <div class="flex items-center justify-center">
                            <span class="text-xl mr-2">🔋</span>
                            <div class="text-center lang-text"
                                data-en="<span class='font-bold text-emerald-800'>🍲 Yummy Lunch, Dream Time (Nap) & Wake Up Stretch</span><br><span class='text-xs text-emerald-600'>Resting our brains and fueling our growing bodies.</span>"
                                data-vi="<span class='font-bold text-emerald-800'>🍲 Bữa trưa ngon miệng, ngủ trưa và thức dậy, Thể dục</span><br><span class='text-xs text-emerald-600'>Nạp năng lượng và nghỉ ngơi để não bộ sẵn sàng.</span>">
                                <span class="font-bold text-emerald-800">🍲 Yummy Lunch, Dream Time (Nap) & Wake Up Stretch</span><br><span class="text-xs text-emerald-600">Resting our brains and fueling our growing bodies.</span>
                            </div>
                        </div>
                    </td>
                </tr>

                <tr>
                    <td class="p-3 border-b border-gray-100 font-bold text-gray-600 text-center whitespace-nowrap bg-gray-50">14:00 - 15:00</td>
                    <td class="p-3 border-b border-gray-100 bg-pink-50 border-r border-white cell-hover lang-text"
                        data-en="<span class='text-lg'>🎨</span> <span class='font-bold text-pink-800'>Magic Colors</span><br><span class='text-xs text-pink-600'>Drawing fun pictures.</span>"
                        data-vi="<span class='text-lg'>🎨</span> <span class='font-bold text-pink-800'>Sắc màu Kỳ diệu</span><br><span class='text-xs text-pink-600'>Vẽ những bức tranh thật vui.</span>">
                        <span class="text-lg">🎨</span> <span class="font-bold text-pink-800">Magic Colors</span><br><span class="text-xs text-pink-600">Drawing fun pictures.</span>
                    </td>
                    <td class="p-3 border-b border-gray-100 bg-pink-50 border-r border-white cell-hover lang-text"
                        data-en="<span class='text-lg'>🖌️</span> <span class='font-bold text-pink-800'>Painting Fun</span><br><span class='text-xs text-pink-600'>Mixing colors with brushes!</span>"
                        data-vi="<span class='text-lg'>🖌️</span> <span class='font-bold text-pink-800'>Vui Vẽ tranh</span><br><span class='text-xs text-pink-600'>Dùng cọ pha trộn màu sắc!</span>">
                        <span class="text-lg">🖌️</span> <span class="font-bold text-pink-800">Painting Fun</span><br><span class="text-xs text-pink-600">Mixing colors with brushes!</span>
                    </td>
                    <td class="p-3 border-b border-gray-100 bg-pink-50 border-r border-white cell-hover lang-text"
                        data-en="<span class='text-lg'>✂️</span> <span class='font-bold text-pink-800'>Paper Crafts</span><br><span class='text-xs text-pink-600'>Making beautiful things by hand.</span>"
                        data-vi="<span class='text-lg'>✂️</span> <span class='font-bold text-pink-800'>Cắt dán Thủ công</span><br><span class='text-xs text-pink-600'>Tự tay làm những món đồ xinh xắn.</span>">
                        <span class="text-lg">✂️</span> <span class="font-bold text-pink-800">Paper Crafts</span><br><span class="text-xs text-pink-600'>Making beautiful things by hand.</span>
                    </td>
                    <td class="p-3 border-b border-gray-100 bg-blue-100 border-r border-white cell-hover lang-text"
                        data-en="<span class='text-lg'>🎤</span> <span class='font-bold text-blue-800'>Show & Tell</span><br><span class='text-xs text-blue-600'>Showing friends what we made.</span>"
                        data-vi="<span class='text-lg'>🎤</span> <span class='font-bold text-blue-800'>Mang đến & Kể chuyện</span><br><span class='text-xs text-blue-600'>Khoe với bạn bè món đồ mình làm.</span>">
                        <span class="text-lg">🎤</span> <span class="font-bold text-blue-800">Show & Tell</span><br><span class="text-xs text-blue-600">Showing friends what we made.</span>
                    </td>
                    <td class="p-3 border-b border-gray-100 bg-rose-100 cell-hover lang-text"
                        data-en="<span class='text-lg'>💃</span> <span class='font-bold text-rose-800'>Happy Dance Party</span><br><span class='text-xs text-rose-600'>Jumping and dancing to fun English songs.</span>"
                        data-vi="<span class='text-lg'>💃</span> <span class='font-bold text-rose-800'>Tiệc Nhảy múa Vui nhộn</span><br><span class='text-xs text-rose-600'>Nhảy múa tung tăng theo nhạc Tiếng Anh.</span>">
                        <span class="text-lg">💃</span> <span class="font-bold text-rose-800">Happy Dance Party</span><br><span class="text-xs text-rose-600">Jumping and dancing to fun English songs.</span>
                    </td>
                </tr>

                <tr>
                    <td class="p-2 border-b border-gray-100 font-bold text-gray-400 text-center text-xs bg-gray-50">15:00 - 15:10</td>
                    <td colspan="5" class="lang-text p-2 border-b border-gray-100 bg-gray-100 text-center text-gray-500 text-xs uppercase font-bold tracking-wider"
                        data-en="💧 Water Break & Toilet" data-vi="💧 Uống nước & Đi vệ sinh">
                        💧 Water Break & Toilet
                    </td>
                </tr>

                <tr>
                    <td class="p-3 border-b border-gray-100 font-bold text-gray-600 text-center whitespace-nowrap bg-gray-50">15:10 - 16:00</td>
                    <td class="p-3 border-b border-gray-100 bg-indigo-50 border-r border-white cell-hover lang-text"
                        data-en="<span class='text-lg'>🌍</span> <span class='font-bold text-indigo-800'>World Friends</span><br><span class='text-xs text-indigo-600'>Learning about kids in other places.</span>"
                        data-vi="<span class='text-lg'>🌍</span> <span class='font-bold text-indigo-800'>Bạn bè Khắp nơi</span><br><span class='text-xs text-indigo-600'>Tìm hiểu các bạn nhỏ nước khác.</span>">
                        <span class="text-lg">🌍</span> <span class="font-bold text-indigo-800">World Friends</span><br><span class="text-xs text-indigo-600">Learning about kids in other places.</span>
                    </td>
                    <td class="p-3 border-b border-gray-100 bg-cyan-50 border-r border-white cell-hover lang-text"
                        data-en="<span class='text-lg'>⌨️</span> <span class='font-bold text-cyan-800'>iPad Learning</span><br><span class='text-xs text-cyan-600'>Safe, fun learning apps.</span>"
                        data-vi="<span class='text-lg'>⌨️</span> <span class='font-bold text-cyan-800'>Học trên iPad</span><br><span class='text-xs text-cyan-600'>Các ứng dụng học tập an toàn, thú vị.</span>">
                        <span class="text-lg">⌨️</span> <span class="font-bold text-cyan-800">iPad Learning</span><br><span class="text-xs text-cyan-600">Safe, fun learning apps.</span>
                    </td>
                    <td class="p-3 border-b border-gray-100 bg-cyan-50 border-r border-white cell-hover lang-text"
                        data-en="<span class='text-lg'>🧩</span> <span class='font-bold text-cyan-800'>Puzzle Masters</span><br><span class='text-xs text-cyan-600'>Fun shape and pattern matching.</span>"
                        data-vi="<span class='text-lg'>🧩</span> <span class='font-bold text-cyan-800'>Bậc thầy Giải đố</span><br><span class='text-xs text-cyan-600'>Trò chơi ghép hình và tìm quy luật.</span>">
                        <span class="text-lg">🧩</span> <span class="font-bold text-cyan-800">Puzzle Masters</span><br><span class="text-xs text-cyan-600">Fun shape and pattern matching.</span>
                    </td>
                    <td class="p-3 border-b border-gray-100 bg-cyan-50 border-r border-white cell-hover lang-text"
                        data-en="<span class='text-lg'>📱</span> <span class='font-bold text-cyan-800'>Safe Tech Time</span><br><span class='text-xs text-cyan-600'>Drawing on tablets!</span>"
                        data-vi="<span class='text-lg'>📱</span> <span class='font-bold text-cyan-800'>Công nghệ An toàn</span><br><span class='text-xs text-cyan-600'>Tập vẽ trên máy tính bảng!</span>">
                        <span class="text-lg">📱</span> <span class="font-bold text-cyan-800">Safe Tech Time</span><br><span class="text-xs text-cyan-600">Drawing on tablets!</span>
                    </td>
                    <td class="p-3 border-b border-gray-100 bg-yellow-100 border-2 border-yellow-300 cell-hover relative lang-text"
                        data-en="<span class='absolute top-1 right-1 text-2xl'>🌟</span><span class='text-lg'>🎥</span> <span class='font-bold text-yellow-900'>Smile for the Camera</span><br><span class='text-xs text-yellow-700 font-medium'>Filming our cute projects for Mom & Dad.</span>"
                        data-vi="<span class='absolute top-1 right-1 text-2xl'>🌟</span><span class='text-lg'>🎥</span> <span class='font-bold text-yellow-900'>Cười lên nào</span><br><span class='text-xs text-yellow-700 font-medium'>Quay video khoe sản phẩm với Ba Mẹ.</span>">
                        <span class="absolute top-1 right-1 text-2xl">🌟</span><span class="text-lg">🎥</span> <span class="font-bold text-yellow-900">Smile for the Camera</span><br><span class="text-xs text-yellow-700 font-medium">Filming our cute projects for Mom & Dad.</span>
                    </td>
                </tr>

                <tr>
                    <td class="p-3 font-bold text-gray-600 text-center whitespace-nowrap bg-gray-50 rounded-bl-lg lang-text" data-en="16:00 - 17:00" data-vi="16:00 - 17:00">16:00 - 17:00</td>
                    <td class="p-3 bg-purple-50 border-r border-white cell-hover lang-text"
                        data-en="<span class='text-lg'>🧱</span> <span class='font-bold text-purple-800'>Free Play & LEGO</span><br><span class='text-xs text-purple-600'>Building whatever we want with friends.</span>"
                        data-vi="<span class='text-lg'>🧱</span> <span class='font-bold text-purple-800'>Chơi tự do & LEGO</span><br><span class='text-xs text-purple-600'>Tự do lắp ghép cùng bạn bè.</span>">
                        <span class="text-lg">🧱</span> <span class="font-bold text-purple-800">Free Play & LEGO</span><br><span class="text-xs text-purple-600">Building whatever we want with friends.</span>
                    </td>
                    <td class="p-3 bg-purple-50 border-r border-white cell-hover lang-text"
                        data-en="<span class='text-lg'>🎲</span> <span class='font-bold text-purple-800'>Board Games</span><br><span class='text-xs text-purple-600'>Fun, easy games and sharing toys.</span>"
                        data-vi="<span class='text-lg'>🎲</span> <span class='font-bold text-purple-800'>Trò chơi Cờ bàn</span><br><span class='text-xs text-purple-600'>Những trò chơi vui nhộn và chia sẻ đồ chơi.</span>">
                        <span class="text-lg">🎲</span> <span class="font-bold text-purple-800">Board Games</span><br><span class="text-xs text-purple-600">Fun, easy games and sharing toys.</span>
                    </td>
                    <td class="p-3 bg-purple-50 border-r border-white cell-hover lang-text"
                        data-en="<span class='text-lg'>📖</span> <span class='font-bold text-purple-800'>Story Listening</span><br><span class='text-xs text-purple-600'>Relaxing in reading nooks with audiobooks.</span>"
                        data-vi="<span class='text-lg'>📖</span> <span class='font-bold text-purple-800'>Nghe Đọc truyện</span><br><span class='text-xs text-purple-600'>Thư giãn ở góc đọc sách với sách nói.</span>">
                        <span class="text-lg">📖</span> <span class="font-bold text-purple-800">Story Listening</span><br><span class="text-xs text-purple-600">Relaxing in reading nooks with audiobooks.</span>
                    </td>
                    <td class="p-3 bg-purple-50 border-r border-white cell-hover lang-text"
                        data-en="<span class='text-lg'>🎨</span> <span class='font-bold text-purple-800'>Coloring Fun</span><br><span class='text-xs text-purple-600'>Calm coloring before heading home.</span>"
                        data-vi="<span class='text-lg'>🎨</span> <span class='font-bold text-purple-800'>Vui Tô màu</span><br><span class='text-xs text-purple-600'>Tô màu thư giãn trước khi về nhà.</span>">
                        <span class="text-lg">🎨</span> <span class="font-bold text-purple-800">Coloring Fun</span><br><span class="text-xs text-purple-600">Calm coloring before heading home.</span>
                    </td>
                    <td class="p-3 bg-purple-50 rounded-br-lg border-r border-white cell-hover lang-text"
                        data-en="<span class='text-lg'>🧩</span> <span class='font-bold text-purple-800'>Big Floor Puzzles</span><br><span class='text-xs text-purple-600'>Solving big picture puzzles together!</span>"
                        data-vi="<span class='text-lg'>🧩</span> <span class='font-bold text-purple-800'>Xếp hình Khổng lồ</span><br><span class='text-xs text-purple-600'>Cùng nhau giải đố những bức tranh lớn!</span>">
                        <span class="text-lg">🧩</span> <span class="font-bold text-purple-800">Big Floor Puzzles</span><br><span class="text-xs text-purple-600">Solving big picture puzzles together!</span>
                    </td>
                </tr>

            </tbody>
        </table>
    </div>
</div>

<script>
    let currentLang = 'en';
    function toggleLanguage() {
        currentLang = currentLang === 'en' ? 'vi' : 'en';
        document.querySelectorAll('.lang-text').forEach(el => {
            el.innerHTML = el.getAttribute('data-' + currentLang);
        });
        document.getElementById('lang-btn').innerHTML = currentLang === 'en' 
            ? '<img src="https://flagcdn.com/w20/vn.png" width="20" class="inline-block mr-2" alt="VN"> Tiếng Việt' 
            : '<img src="https://flagcdn.com/w20/gb.png" width="20" class="inline-block mr-2" alt="UK"> English';
    }

    // Initialize translations on load
    document.querySelectorAll('.lang-text').forEach(el => {
        el.innerHTML = el.getAttribute('data-en');
    });

    // PDF generation using html2pdf
    function downloadPDF() {
        // Hide controls before generating PDF
        const controls = document.getElementById('controls-bar');
        controls.style.display = 'none';
        
        const element = document.getElementById('timetable-content');
        
        // Force dimensions to create a perfectly bounded single page PDF
        // that is fully rendered without squishing on mobile devices
        const originalWidth = element.style.width;
        element.style.width = '1200px'; 
        
        // Use timeout to allow DOM to visually update before capture
        setTimeout(() => {
            const pxToInches = 96;
            const widthIn = 1200 / pxToInches;
            const heightIn = element.scrollHeight / pxToInches;

            const opt = {
                margin:       0,
                filename:     'HEC_Summer_Camp_Grades_1_2.pdf',
                image:        { type: 'jpeg', quality: 1.0 },
                html2canvas:  { scale: 2, windowWidth: 1200 },
                jsPDF:        { unit: 'in', format: [widthIn, heightIn], orientation: widthIn > heightIn ? 'landscape' : 'portrait' }
            };
            
            html2pdf().set(opt).from(element).save().then(() => {
                // Restore original state
                controls.style.display = 'flex';
                element.style.width = originalWidth;
            });
        }, 100);
    }
</script>

</body>
</html>
"""

user_html = user_html.replace('LOGO_PLACEHOLDER', base64_logo)

with open('summer-camp-timetable-g12.html', 'w', encoding='utf-8') as f:
    f.write(user_html)
print("Created summer-camp-timetable-g12.html")
