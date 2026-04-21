/**
 * translations.js
 *
 * Complete bilingual dictionary (English / Vietnamese) for every
 * translatable string on the HEC landing page. Strings are referenced
 * by their `data-i18n` key. The i18n engine in language.js reads this
 * object and applies the appropriate language on page load and on
 * manual toggle.
 *
 * Organisation: keys are grouped by section for readability. Flat
 * namespace avoids nesting complexity.
 */

const HEC_TRANSLATIONS = {

  /* ─── Navbar ──────────────────────────────────────────────── */
  "nav.home":          { en: "Home",               vi: "Trang chủ" },
  "nav.programs":      { en: "Programs",           vi: "Chương trình" },
  "nav.readingClub":   { en: "Reading Club",       vi: "CLB Đọc sách" },
  "nav.admissions":    { en: "Admissions & Fees",  vi: "Tuyển sinh & Học phí" },
  "nav.contact":       { en: "Contact",            vi: "Liên hệ" },
  "nav.enrollNow":     { en: "Enroll Now",         vi: "Đăng ký ngay" },
  "nav.login":         { en: "Log in",             vi: "Đăng nhập" },

  /* ─── Hero ────────────────────────────────────────────────── */
  "hero.headline":     { en: "Where Small Classes Build\nBig Confidence",
                         vi: "Lớp nhỏ — Tự tin lớn" },
  "hero.subheadline":  { en: "US-licensed teacher • International curriculum • Transparent per-session fees • Free Saturday Reading Club",
                         vi: "Giáo viên được cấp phép Hoa Kỳ • Chương trình quốc tế • Học phí minh bạch theo buổi • CLB Đọc miễn phí Thứ Bảy" },
  "hero.ctaPrimary":   { en: "Book a Free Trial Class",
                         vi: "Đặt lịch học thử miễn phí" },
  "hero.ctaSecondary": { en: "Explore Programs",
                         vi: "Xem chương trình" },
  "hero.stat1Value":   { en: "≤15",               vi: "≤15" },
  "hero.stat1Label":   { en: "students per class", vi: "học sinh / lớp" },
  "hero.stat2Value":   { en: "90′",               vi: "90′" },
  "hero.stat2Label":   { en: "each session",       vi: "mỗi buổi học" },
  "hero.stat3Value":   { en: "Free",              vi: "Miễn phí" },
  "hero.stat3Label":   { en: "Saturday Reading Club", vi: "CLB Đọc Thứ Bảy" },

  /* ─── Authority ───────────────────────────────────────────── */
  "auth.title":        { en: "Why Parents in Hanoi Trust HEC",
                         vi: "Vì sao phụ huynh Hà Nội tin tưởng HEC" },
  "auth.badge1":       { en: "US Licensed Teacher",
                         vi: "Giáo viên được cấp phép Hoa Kỳ" },
  "auth.badge1Desc":   { en: "Certified by the State of New Jersey, USA — bringing global best practices to every lesson.",
                         vi: "Được chứng nhận bởi Bang New Jersey, Hoa Kỳ — mang phương pháp tiên tiến nhất vào từng bài học." },
  "auth.badge2":       { en: "Cambridge & Oxford Curriculum",
                         vi: "Chương trình Cambridge & Oxford" },
  "auth.badge2Desc":   { en: "Oxford Discover, National Geographic Look, and Cambridge Math — world-class resources for every level.",
                         vi: "Oxford Discover, National Geographic Look và Cambridge Math — tài liệu đẳng cấp quốc tế cho mọi trình độ." },
  "auth.badge3":       { en: "Project-Based Learning",
                         vi: "Học qua dự án (PBL)" },
  "auth.badge3Desc":   { en: "Students solve real problems, present ideas, and build portfolios — not just memorize textbooks.",
                         vi: "Học sinh giải quyết vấn đề thực tế, thuyết trình ý tưởng và xây dựng portfolio — không chỉ học vẹt." },
  "auth.badge4":       { en: "Inquiry-Based Approach",
                         vi: "Phương pháp khám phá" },
  "auth.badge4Desc":   { en: "Every class starts with a Big Question. Students investigate, discuss, and discover answers together.",
                         vi: "Mỗi buổi học bắt đầu bằng Câu hỏi lớn. Học sinh tìm hiểu, thảo luận và khám phá câu trả lời cùng nhau." },

  /* ─── Programs ────────────────────────────────────────────── */
  "prog.title":        { en: "Our Programs",       vi: "Chương trình học" },
  "prog.subtitle":     { en: "Small classes, big results. Each program uses internationally recognized textbooks with structured learning goals.",
                         vi: "Lớp nhỏ, kết quả lớn. Chương trình sử dụng giáo trình quốc tế với mục tiêu học tập rõ ràng." },
  "prog.seatsLeft":    { en: "seats left",          vi: "chỗ còn" },
  "prog.perSession":   { en: "/session",            vi: "/buổi" },
  "prog.viewDetails":  { en: "View Details",        vi: "Xem chi tiết" },
  "prog.fillingFast":  { en: "Filling fast",        vi: "Sắp đầy" },
  "prog.open":         { en: "Open",                vi: "Mở đăng ký" },
  "prog.limited":      { en: "Limited",             vi: "Có hạn" },
  "prog.full":         { en: "Waitlist",             vi: "Đã đầy" },

  /* ─── Reading Club ────────────────────────────────────────── */
  "rc.title":          { en: "Saturday Reading Club",
                         vi: "CLB Đọc sách Thứ Bảy" },
  "rc.subtitle":       { en: "Every Saturday, 14:00–16:00 • Completely free • All ages welcome",
                         vi: "Thứ Bảy hằng tuần, 14:00–16:00 • Hoàn toàn miễn phí • Mọi lứa tuổi" },
  "rc.free":           { en: "Free",                vi: "Miễn phí" },
  "rc.badge2":         { en: "Family-friendly",     vi: "Phù hợp gia đình" },
  "rc.badge3":         { en: "Drop-in welcome",     vi: "Tự do tham gia" },
  "rc.point1Title":    { en: "Build a reading habit",
                         vi: "Hình thành thói quen đọc" },
  "rc.point1Desc":     { en: "Choose from our shelf or bring your own. Calm atmosphere with encouragement.",
                         vi: "Tự chọn sách hoặc mang theo. Không khí nhẹ nhàng, khích lệ tích cực." },
  "rc.point2Title":    { en: "Language growth",
                         vi: "Phát triển ngôn ngữ" },
  "rc.point2Desc":     { en: "Vocabulary games, discussion circles, and mini-presentations every week.",
                         vi: "Trò chơi từ vựng, thảo luận nhóm và thuyết trình ngắn mỗi tuần." },
  "rc.point3Title":    { en: "Confidence & community",
                         vi: "Tự tin & cộng đồng" },
  "rc.point3Desc":     { en: "Low-pressure sharing with peers and coaches in a supportive environment.",
                         vi: "Chia sẻ thoải mái cùng bạn bè và giáo viên trong môi trường hỗ trợ." },
  "rc.cta":            { en: "Reserve Your Free Seat",
                         vi: "Giữ chỗ miễn phí" },
  "rc.note":           { en: "Seats are limited — RSVP helps us prepare the right books and small groups.",
                         vi: "Số chỗ có hạn — RSVP giúp chúng tôi chuẩn bị sách và nhóm phù hợp." },
  "rc.location":       { en: "No. 25, Alley 242 Láng, Đống Đa, Hanoi",
                         vi: "Số 25, ngõ 242 Láng, Đống Đa, Hà Nội" },

  /* ─── Testimonials ────────────────────────────────────────── */
  "test.title":        { en: "What Parents Say",    vi: "Phụ huynh nói gì?" },
  "test.t1Name":       { en: "Ms. Linh",            vi: "Chị Linh" },
  "test.t1Grade":      { en: "Grade 4 Parent",      vi: "Phụ huynh lớp 4" },
  "test.t1Quote":      { en: "\"After just one month, my daughter reads more willingly and explains her ideas with clarity. The free Reading Club made a big difference.\"",
                         vi: "\"Sau 1 tháng, con chủ động đọc hơn và trình bày ý tưởng rõ ràng. CLB Đọc miễn phí tạo ra sự khác biệt lớn.\"" },
  "test.t2Name":       { en: "Mr. Minh",            vi: "Anh Minh" },
  "test.t2Grade":      { en: "Grade 6 Parent",      vi: "Phụ huynh lớp 6" },
  "test.t2Quote":      { en: "\"Clear goals, small classes, and coaches who really listen. My son now enjoys non-fiction and presents with confidence.\"",
                         vi: "\"Mục tiêu rõ ràng, lớp ít học sinh, giáo viên thật sự lắng nghe. Con thích đọc non-fiction và thuyết trình tự tin hơn.\"" },
  "test.t3Name":       { en: "Ms. Hoa",             vi: "Chị Hoa" },
  "test.t3Grade":      { en: "Grade 2 Parent",      vi: "Phụ huynh lớp 2" },
  "test.t3Quote":      { en: "\"The phonics and fluency routines are simple to practice at home. Saturday Reading Club has become our favorite weekly habit.\"",
                         vi: "\"Phonics và luyện đọc trôi chảy dễ thực hành ở nhà. Chiều Thứ Bảy tới CLB Đọc thành thói quen yêu thích của con.\"" },

  /* ─── Methodology ─────────────────────────────────────────── */
  "method.title":      { en: "How We Teach",         vi: "Phương pháp giảng dạy" },
  "method.subtitle":   { en: "Every lesson is designed with purpose — not just coverage, but mastery.",
                         vi: "Mỗi bài học đều được thiết kế có mục đích — không chỉ dạy hết, mà dạy sâu." },
  "method.m1Title":    { en: "Structured Goals",     vi: "Mục tiêu rõ ràng" },
  "method.m1Desc":     { en: "Weekly learning targets with visible progress checkpoints for parents and students.",
                         vi: "Mục tiêu hằng tuần với các mốc tiến bộ rõ ràng cho phụ huynh và học sinh." },
  "method.m2Title":    { en: "Active Learning",      vi: "Học chủ động" },
  "method.m2Desc":     { en: "Discussions, presentations, and collaborative projects — students talk more than the teacher.",
                         vi: "Thảo luận, thuyết trình và dự án nhóm — học sinh nói nhiều hơn giáo viên." },
  "method.m3Title":    { en: "Formative Assessment",  vi: "Đánh giá quá trình" },
  "method.m3Desc":     { en: "Continuous feedback loops, not just end-of-term exams. We catch gaps early.",
                         vi: "Phản hồi liên tục, không chỉ kiểm tra cuối kỳ. Chúng tôi phát hiện lỗ hổng sớm." },
  "method.m4Title":    { en: "Parent Partnership",    vi: "Đồng hành phụ huynh" },
  "method.m4Desc":     { en: "Monthly progress reports, Zalo updates, and open-door classroom visits.",
                         vi: "Báo cáo tiến bộ hằng tháng, cập nhật qua Zalo và mời phụ huynh dự giờ." },

  /* ─── Admissions ──────────────────────────────────────────── */
  "adm.title":         { en: "Simple Enrollment Process",
                         vi: "Quy trình đăng ký đơn giản" },
  "adm.step1":         { en: "Submit Form",          vi: "Gửi đăng ký" },
  "adm.step1Desc":     { en: "Fill in basic details below — takes 30 seconds.",
                         vi: "Điền thông tin cơ bản dưới đây — chỉ mất 30 giây." },
  "adm.step2":         { en: "Free Placement",       vi: "Xếp lớp miễn phí" },
  "adm.step2Desc":     { en: "A quick assessment to find the perfect class level.",
                         vi: "Bài kiểm tra ngắn để tìm lớp phù hợp nhất." },
  "adm.step3":         { en: "Start Learning",       vi: "Bắt đầu học" },
  "adm.step3Desc":     { en: "Join your class with a first-week check-in from the teacher.",
                         vi: "Vào lớp với buổi kiểm tra tuần đầu từ giáo viên." },
  "adm.pricingTitle":  { en: "Transparent Pricing",   vi: "Học phí minh bạch" },
  "adm.price1":        { en: "Standard classes",      vi: "Lớp tiêu chuẩn" },
  "adm.price1Detail":  { en: "210,000₫ / session (90 min)",
                         vi: "210.000₫ / buổi (90 phút)" },
  "adm.price2":        { en: "IELTS Sun Class",       vi: "Lớp IELTS Sun" },
  "adm.price2Detail":  { en: "260,000₫ / session (120 min)",
                         vi: "260.000₫ / buổi (120 phút)" },
  "adm.price3":        { en: "Monthly billing = sessions actually held. No hidden fees.",
                         vi: "Thu phí theo số buổi thực tế. Không phí ẩn." },
  "adm.discountTitle": { en: "Discounts",             vi: "Ưu đãi" },
  "adm.discount1":     { en: "Sibling discount: 5% off for the second child.",
                         vi: "Giảm 5% cho anh/chị em ruột." },
  "adm.discount2":     { en: "Referral bonus: Up to 95% credit when a referred family enrolls.",
                         vi: "Thưởng giới thiệu: Tích lũy đến 95% khi gia đình được giới thiệu đăng ký." },
  "adm.noBookFee":     { en: "No book fees charged currently.",
                         vi: "Hiện không thu phí giáo trình." },

  /* ─── Scarcity CTA ────────────────────────────────────────── */
  "scar.headline":     { en: "Summer 2026 Sessions Are Filling Up",
                         vi: "Lớp Hè 2026 đang được đăng ký nhanh" },
  "scar.subline":      { en: "Only a few seats remain in our most popular programs. Secure your child's spot before enrollment closes.",
                         vi: "Chỉ còn vài chỗ trống trong các chương trình được yêu thích nhất. Giữ chỗ cho con trước khi hết hạn đăng ký." },
  "scar.cta":          { en: "Secure Your Seat Now",
                         vi: "Giữ chỗ ngay" },
  "scar.days":         { en: "Days",                  vi: "Ngày" },
  "scar.hours":        { en: "Hours",                 vi: "Giờ" },
  "scar.minutes":      { en: "Minutes",               vi: "Phút" },
  "scar.seconds":      { en: "Seconds",               vi: "Giây" },

  /* ─── Contact ─────────────────────────────────────────────── */
  "cont.title":        { en: "Get in Touch",          vi: "Liên hệ với chúng tôi" },
  "cont.subtitle":     { en: "Have questions? Send us a message or reach out on Zalo — we respond within 2 hours.",
                         vi: "Có câu hỏi? Gửi tin nhắn hoặc liên hệ qua Zalo — chúng tôi phản hồi trong 2 giờ." },
  "cont.phone":        { en: "Phone",                 vi: "Điện thoại" },
  "cont.address":      { en: "No. 25, Alley 242 Láng Street, Đống Đa District, Hanoi",
                         vi: "Số 25, ngõ 242 Láng, quận Đống Đa, Hà Nội" },
  "cont.studentName":  { en: "Student name",          vi: "Tên học sinh" },
  "cont.grade":        { en: "Grade",                 vi: "Khối lớp" },
  "cont.parentName":   { en: "Parent name",           vi: "Tên phụ huynh" },
  "cont.phonePlc":     { en: "Phone number *",        vi: "Số điện thoại *" },
  "cont.zaloPlc":      { en: "Zalo (optional)",       vi: "Zalo (tuỳ chọn)" },
  "cont.program":      { en: "Select program",        vi: "Chọn chương trình" },
  "cont.message":      { en: "Message (optional)",    vi: "Lời nhắn (tuỳ chọn)" },
  "cont.submit":       { en: "Submit Enrollment",     vi: "Gửi đăng ký" },

  /* ─── Summer Camp NAV & HERO ────────────────────────────────────── */
  "nav.summerCamp":    { en: "Summer Camp",           vi: "Trại Hè" },
  "camp.badgeNew":     { en: "Summer 2026",           vi: "Mùa Hè 2026" },
  "camp.badgeDates":   { en: "June – July",           vi: "Tháng 6 – 7" },
  "camp.badgeTime":    { en: "08:00 – 17:00",         vi: "08:00 – 17:00" },
  "camp.heroTitle":    { en: "Every Minute Matters.", vi: "Từng Phút Đều Vô Giá." },
  "camp.heroSub":      { en: "Don't let two months of summer erase a year of progress. While others fall behind, your child will step ahead.", 
                         vi: "Đừng để 2 tháng hè xóa sạch 1 năm nỗ lực. Trong khi các bạn khác tụt hậu, con bạn sẽ bứt phá." },
  "camp.pill1":        { en: "Future-Proof Skills",   vi: "Kỹ năng Tương lai" },
  "camp.pill2":        { en: "Critical Thinking",     vi: "Tư duy Phản biện" },
  "camp.pill3":        { en: "Active English Leadership", vi: "Lãnh đạo Tiếng Anh Chủ động" },
  "camp.badgeGroups":  { en: "Grades 1-2, 3-5, & 6-8",      vi: "Lớp 1-2, 3-5 & 6-8" },
  "camp.ctaPrimary":   { en: "Register for Summer Camp", vi: "Đăng ký Trại Hè" },
  "camp.ctaSecondary": { en: "View Full Timetable",   vi: "Xem Thời Khóa Biểu" },

  /* ─── Summer Camp HIGHLIGHTS ──────────────────────────────── */
  "camp.h1Title":      { en: "Full English Immersion", vi: "Đắm chìm trong Tiếng Anh" },
  "camp.h1Desc":       { en: "Project-based English from 8:15–10:00 every day. Students use English to investigate, debate, and present — not just memorize.",
                         vi: "Tiếng Anh học qua dự án từ 8:15–10:00 mỗi ngày. Học sinh dùng Tiếng Anh để điều tra, phản biện và thuyết trình — không chỉ học thuộc lòng." },
  "camp.h2Title":      { en: "STEAM & Engineering",    vi: "Khoa học Kỹ thuật STEAM" },
  "camp.h2Desc":       { en: "Hands-on robotics, coding, and physical prototyping. Students build, test, fail, and iterate — real engineering thinking.",
                         vi: "Thực hành robotics, lập trình và tạo mô hình thực tế. Học sinh xây dựng, thử nghiệm, thất bại và lặp lại — tư duy kỹ sư thực thụ." },
  "camp.h3Title":      { en: "Creative Arts & Dance",  vi: "Nghệ thuật & Nhảy múa" },
  "camp.h3Desc":       { en: "Afternoon arts, crafts, and dynamic dance classes fuel creativity and self-expression through multiple modalities.",
                         vi: "Lớp thủ công nghệ thuật và khiêu vũ sôi động buổi chiều nuôi dưỡng sự sáng tạo và thể hiện bản thân qua nhiều hình thức." },
  "camp.h4Title":      { en: "Mindfulness & Wellbeing",vi: "Chánh niệm & Thể chất" },
  "camp.h4Desc":       { en: "Every day starts with emotional check-ins. Supervised nap time, hydration breaks, and nutritious lunch included.",
                         vi: "Bắt đầu mỗi ngày với kiểm tra cảm xúc. Bao gồm kiểm soát giấc ngủ trưa, giờ uống nước và bữa trưa dinh dưỡng." },

  /* ─── Summer Camp TIMETABLE ───────────────────────────────── */
  "camp.ttTitle":      { en: "Weekly Timetable",      vi: "Thời khóa biểu tuần" },
  "camp.ttSub":        { en: "A purposeful day packed with active learning, creative exploration, and structured play — all in English.",
                         vi: "Một ngày ý nghĩa ngập tràn học tập chủ động, khám phá sáng tạo và vui chơi có cấu trúc — hoàn toàn bằng Tiếng Anh." },
  "camp.thTime":       { en: "Time",                  vi: "Thời gian" },
  "camp.thMon":        { en: "Monday<br><small>The Hook (Explore)</small>", vi: "Thứ 2<br><small>Khơi Nguồn Sáng Tạo</small>" },
  "camp.thTue":        { en: "Tuesday<br><small>Research & Build</small>", vi: "Thứ 3<br><small>Thực Hành Lắp Ráp</small>" },
  "camp.thWed":        { en: "Wednesday<br><small>Global Problem Solving</small>", vi: "Thứ 4<br><small>Phát Triển Tư Duy</small>" },
  "camp.thThu":        { en: "Thursday<br><small>Test & Connect</small>", vi: "Thứ 5<br><small>Làm Việc Nhóm</small>" },
  "camp.thFri":        { en: "Friday<br><small>The Grand Showcase</small>", vi: "Thứ 6<br><small>Báo Cáo Thành Quả</small>" },

  /* 8:00 */
  "camp.mindTitle":    { en: "Mindfulness & Resilience", vi: "Chánh niệm & Kiên cường" },
  "camp.mindDesc":     { en: "A calm brain learns faster. Daily emotional check-ins.", vi: "Não bộ bình tĩnh học nhanh hơn. Kiểm tra cảm xúc hàng ngày." },

  /* 8:30 */
  "camp.eng1Title":    { en: "Active English (PBL)",  vi: "Tiếng Anh (Dự án)" },
  "camp.eng1Desc":     { en: "Project Intro. Using English to ask big questions.", vi: "Giới thiệu Dự án. Dùng Tiếng Anh để đặt câu hỏi lớn." },
  "camp.eng2Title":    { en: "Active English (PBL)",  vi: "Tiếng Anh (Dự án)" },
  "camp.eng2Desc":     { en: "Role-play and vocabulary building for real-world use.", vi: "Đóng vai và xây dựng từ vựng thực tế." },
  "camp.eng3Title":    { en: "Active English (PBL)",  vi: "Tiếng Anh (Dự án)" },
  "camp.eng3Desc":     { en: "Interactive read-alouds and reading comprehension.", vi: "Đọc tương tác và rèn luyện đọc hiểu." },
  "camp.eng4Title":    { en: "Active English (PBL)",  vi: "Tiếng Anh (Dự án)" },
  "camp.eng4Desc":     { en: "Debates and presentation preparation.", vi: "Tranh biện và chuẩn bị thuyết trình." },
  "camp.eng5Title":    { en: "Active English (PBL)",  vi: "Tiếng Anh (Dự án)" },
  "camp.eng5Desc":     { en: "Final project reflections and confident speaking.", vi: "Đúc kết dự án và tự tin thuyết trình." },

  /* 10:30 */
  "camp.break1":       { en: "Brain Break & Hydration", vi: "Giải lao & Uống nước" },

  /* 10:40 */
  "camp.st1Title":     { en: "Hands-on Engineering",  vi: "Kỹ thuật Thực hành" },
  "camp.st1Desc":      { en: "Blueprinting and designing physical solutions.", vi: "Lên bản vẽ và thiết kế giải pháp thực tế." },
  "camp.st2Title":     { en: "Robotics",              vi: "Lắp ráp Robot" },
  "camp.st2Desc":      { en: "Building functional, moving robots.", vi: "Lắp ráp robot có chức năng chuyển động." },
  "camp.st3Title":     { en: "Hands-on Engineering",  vi: "Kỹ thuật Thực hành" },
  "camp.st3Desc":      { en: "Creating physical prototypes.", vi: "Tạo nguyên mẫu vật lý." },
  "camp.st4Title":     { en: "Robotics & Testing",    vi: "Thử nghiệm Robot" },
  "camp.st4Desc":      { en: "Fixing and improving designs.", vi: "Sửa chữa và cải tiến thiết kế." },
  "camp.st5Title":     { en: "Engineering Challenge", vi: "Thử thách Kỹ thuật" },
  "camp.st5Desc":      { en: "Final stress-test of weekly builds.", vi: "Kiểm tra độ bền dự án cuối tuần." },

  /* 11:40 */
  "camp.lunchTitle":   { en: "Nutritious Lunch",      vi: "Bữa trưa Dinh dưỡng" },
  "camp.lunchDesc":    { en: "Fueling active minds.", vi: "Nạp năng lượng cho trí tuệ" },

  /* 12:00 */
  "camp.napTitle":     { en: "Deep Brain Recharge (Supervised Nap)", vi: "Nạp năng lượng Não bộ (Ngủ trưa)" },
  "camp.napDesc":      { en: "Crucial for memory consolidation, physical growth, and afternoon focus.", 
                         vi: "Vô cùng quan trọng để củng cố trí nhớ, phát triển thể chất và sự tập trung." },

  /* 13:45 */
  "camp.break2":       { en: "Wake Up, Stretch & Afternoon Snack", vi: "Thức dậy, Vươn vai & Ăn nhẹ" },

  /* 14:00 */
  "camp.art1Title":    { en: "Creative Arts",         vi: "Nghệ thuật Sáng tạo" },
  "camp.art1Desc":     { en: "Arts & crafts tied to the weekly theme.", vi: "Thủ công gắn liền với chủ đề tuần." },
  "camp.art2Title":    { en: "Creative Arts",         vi: "Nghệ thuật Sáng tạo" },
  "camp.art2Desc":     { en: "Fine motor skill development through art.", vi: "Phát triển vận động tinh qua nghệ thuật." },
  "camp.art3Title":    { en: "Creative Arts",         vi: "Nghệ thuật Sáng tạo" },
  "camp.art3Desc":     { en: "Bringing imagination into reality.", vi: "Biến trí tưởng tượng thành hiện thực." },
  "camp.art4Title":    { en: "Creative Arts",         vi: "Nghệ thuật Sáng tạo" },
  "camp.art4Desc":     { en: "Finishing touches on physical projects.", vi: "Hoàn thiện các dự án thực tế." },
  "camp.danceTitle":   { en: "Dynamic Dance Class",   vi: "Lớp Nhảy Năng động" },
  "camp.danceDesc":    { en: "End of week energy release and coordination.", vi: "Giải phóng năng lượng và điều hòa cơ thể cuối tuần." },

  /* 15:00 */
  "camp.break3":       { en: "Brain Break & Hydration", vi: "Giải lao & Uống nước" },

  /* 15:10 */
  "camp.pm1Title":     { en: "Global Empathy",        vi: "Thấu cảm Toàn cầu" },
  "camp.pm1Desc":      { en: "Social studies & world cultures.", vi: "Kiến thức xã hội & văn hóa thế giới." },
  "camp.pm2Title":     { en: "Future Coding",         vi: "Lập trình Tương lai" },
  "camp.pm2Desc":      { en: "Learning the language of the future.", vi: "Học ngôn ngữ của kỷ nguyên mới." },
  "camp.pm3Title":     { en: "Tech & Logic",          vi: "Công nghệ & Logic" },
  "camp.pm3Desc":      { en: "Advanced logic puzzles to sharpen the mind.", vi: "Câu đố logic nâng cao rèn luyện trí não." },
  "camp.pm4Title":     { en: "Digital Mastery",       vi: "Làm chủ Kỹ thuật số" },
  "camp.pm4Desc":      { en: "App logic & finalizing digital portfolios.", vi: "Logic ứng dụng & hoàn thiện hồ sơ dự án." },
  "camp.pm5Title":     { en: "Project Showcase",      vi: "Báo Cáo Thành Quả" },
  "camp.pm5Desc":      { en: "Recording video portfolios for parents.", vi: "Quay video dự án gửi phụ huynh." },

  /* 16:00 */
  "camp.pickup":       { en: "16:00 – Pickup",        vi: "16:00 – Đón về" },
  "camp.fp1Title":     { en: "Strategic Play",        vi: "Trò chơi Chiến Thuật" },
  "camp.fp1Desc":      { en: "English Board Games (Scrabble, UNO).", vi: "Board Game Tiếng Anh." },
  "camp.fp2Title":     { en: "Unstructured Maker",    vi: "Chế tạo Tự do" },
  "camp.fp2Desc":      { en: "Free-build LEGO & Magnatiles.", vi: "Lắp ráp LEGO & Magnatiles." },
  "camp.fp3Title":     { en: "Audio Immersion",       vi: "Đắm chìm Âm thanh" },
  "camp.fp3Desc":      { en: "English audiobook listening station.", vi: "Trạm đọc sách và nghe sách nói." },
  "camp.fp4Title":     { en: "Mindful Art",           vi: "Nghệ thuật Chánh niệm" },
  "camp.fp4Desc":      { en: "Thematic coloring and journaling.", vi: "Tô màu và viết sổ tay." },
  "camp.fp5Title":     { en: "Community Puzzles",     vi: "Câu đố Cộng đồng" },
  "camp.fp5Desc":      { en: "Large floor puzzles & camp wrap-up.", vi: "Chơi xếp ghép hình lớn và kết thúc." },

  /* CAMP CTA */
  "camp.ctaHeadline":  { en: "Don't Let Summer Slide Steal Your Child's Progress",
                         vi: "Đừng Để Rơi Rụng Kiến Thức Mùa Hè" },
  "camp.ctaSub":       { en: "Spots are limited to 12 per group. Register now to lock in your child's place in Hanoi's most immersive English STEAM camp.",
                         vi: "Sĩ số giới hạn 12 học sinh mỗi lớp. Đăng ký ngay để giữ chỗ tại trại hè tiếng Anh STEAM hàng đầu Hà Nội." },
  "camp.ctaBtn":       { en: "Register Now",          vi: "Đăng ký ngay" },
  "camp.selectTimetable": { en: "Select Timetable / Chọn Thời khoá biểu", vi: "Chọn Thời khoá biểu / Select Timetable" },
  "camp.downloadHero": { en: "Secure Your Child's Advantage & Download Timetable", 
                         vi: "Đảm Bảo Lợi Thế Cho Con & Tải Thời Khóa Biểu" },
  "camp.downloadCTA":  { en: "Claim Your Child's Spot & Download Timetable (PDF)", 
                         vi: "Giữ Chỗ Cho Con & Tải Thời Khóa Biểu (PDF)" },

  /* ─── Footer ──────────────────────────────────────────────── */
  "foot.tagline":      { en: "Small classes. Big confidence.",
                         vi: "Lớp nhỏ. Tự tin lớn." },
  "foot.quickLinks":   { en: "Quick Links",           vi: "Liên kết nhanh" },
  "foot.connect":      { en: "Connect",               vi: "Kết nối" },
  "foot.rights":       { en: "All rights reserved.",   vi: "Bảo lưu mọi quyền." },

  /* ── 404 page ──────────────────────────────────────────────── */
  "err.title":         { en: "Oops — we lost this page!",
                         vi: "Ối — Trang này không tìm thấy!" },
  "err.sub":           { en: "The page you're looking for has moved, or may never have existed. Let's get you back on track.",
                         vi: "Trang bạn tìm kiếm đã bị di chuyển hoặc không tồn tại. Hãy để chúng tôi đưa bạn trở lại." },
  "err.home":          { en: "Back to Home",            vi: "Về Trang Chủ" },
  "err.contact":       { en: "Contact Us",              vi: "Liên Hệ" },
  "err.quickLinks":    { en: "Quick links",             vi: "Liên kết nhanh" },

  /* ── Form feedback ─────────────────────────────────────────── */
  "cont.phoneHint":    { en: "Please enter a valid phone number.",
                         vi: "Vui lòng nhập số điện thoại hợp lệ." },
  "cont.formError":    { en: "Please fill in the required fields before submitting.",
                         vi: "Vui lòng điền đầy đủ thông tin bắt buộc trước khi gửi." },
  "cont.successTitle": { en: "We received your enquiry!",
                         vi: "Chúng tôi đã nhận được yêu cầu của bạn!" },
  "cont.successMsg":   { en: "We'll be in touch within 24 hours. Check your Zalo or phone.",
                         vi: "Chúng tôi sẽ liên hệ trong vòng 24 giờ. Kiểm tra Zalo hoặc điện thoại nhé." },

  /* ─── Holiday Banner ────────────────────────────────────────── */
  "holiday.bannerText": { en: "Holiday Notice: HEC classes paused Apr 25 – May 3 for national holidays.",
                          vi: "Thông báo nghỉ lễ: HEC tạm nghỉ các lớp từ 25/4 – 3/5 nhân dịp lễ Quốc gia." },
  "holiday.bannerLink": { en: "View Schedule →",
                          vi: "Xem lịch nghỉ →" }
};
