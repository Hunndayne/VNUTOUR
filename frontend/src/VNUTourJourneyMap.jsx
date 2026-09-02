import React, { useState, useEffect } from 'react'
import { Reveal } from './LandingPage.jsx'
import vnu2014 from './assets/VNUTOUR14.jpg'
import vnu2013 from './assets/VNUTOUR13.png'
import vnu2012 from './assets/VNUTOUR12.jpg'
import vnu2015 from './assets/VNUTOUR15.jpg'
import vnu2016 from './assets/VNUTOUR16.jpg'
import vnu2017 from './assets/VNUTOUR17.jpg'
import vnu2018 from './assets/VNUTOUR18.jpg'
import vnu2019 from './assets/VNUTOUR19.jpg'
import vnu2020 from './assets/VNUTOUR20.jpg'
import vnu2022 from './assets/VNUTOUR22.jpg'
import vnu2023 from './assets/VNUTOUR23.jpg'
import vnu2024 from './assets/VNUTOUR24.jpg'
import vnu2025 from './assets/VNUTOUR25.jpg'
import vnu2026 from './assets/VNUTOUR26.jpg'

const journeyData = [
  { year: 2012, images: [vnu2012], shortContent: "", detailedContent: "Vào năm 2012, chương trình VNU Tour lần đầu tiên được tổ chức dưới hình thức chạy trạm. Chương trình do Liên chi Đoàn khoa Mạng máy tính và Truyền thông kết hợp cùng Khoa Công nghệ Phần mềm tổ chức tại 2 địa điểm nổi tiếng tại khu đô thị là Hồ đá làng đại học và tại Nhà điều hành Đại học Quốc gia Thành phố Hồ Chí Minh." },
  { year: 2013, images: [vnu2013], shortContent: "", detailedContent: "Tiếp nối thành công từ mùa đầu tiên, tại VNU Tour 2013, chương trình được chia thành 2 vòng tranh đấu vô cùng hấp dẫn là vòng loại và vòng chung kết. Với format mới mẻ và hấp dẫn, VNU Tour cũng một phần thu hút đông đảo sự chú ý của các bạn sinh viên đăng ký tham gia" },
  { year: 2014, images: [vnu2014], shortContent: "Hành trình kết nối Tân sinh viên", detailedContent: "VNU Tour 2014 quay trở lại với tên gọi mới 'Hành trình kết nối Tân sinh viên' và đã ghi nhận hơn 22 đội đăng ký tham gia vòng loại. Tại đây, các bạn Tân sinh viên đã đi qua nhiều địa điểm thú vị ở làng Đại học. Tại mỗi địa điểm, các đội có cơ hội được tham gia vào những trò chơi đồng đội đòi hỏi sự nhanh trí, khéo léo đến từ các bạn sinh viên. Chính nhờ những phút giây căng thẳng và hấp dẫn như thế, VNU Tour 2014 đã đọng lại nhiều kỷ niệm đẹp trong tâm trí của mỗi bạn sinh viên" },
  { year: 2015, images: [vnu2015], shortContent: "", detailedContent: "Lấy đó là động lực để tiếp tục cố gắng và phát triển, VNU Tour 2015 đã thành công được các bạn Tân sinh viên chú ý và yêu thương khi đã ghi nhận 74 đội đăng ký tham gia vòng loại diễn ra vào ngày 30/09/2015. Sau những trận đấu căng thẳng, TOP 33 đội đã có cơ hội được tiến thẳng vào vòng chung kết để cùng nhau chinh phục các giải thưởng tổng giá trị lên đến 1.300.000 nghìn đồng." },
  { year: 2016, images: [vnu2016], shortContent: "", detailedContent: "Đến VNU Tour 2016, TOP 22 đội chơi xuất sắc nhất được BTC chọn lọc kỹ lưỡng và gắt gao từ 40 đội đăng ký tham gia, bước chân vào vòng chung kết và cùng nhau giành lấy một giải thưởng duy nhất trị giá 1.111.000 đồng." },
  { year: 2017, images: [vnu2017], shortContent: "", detailedContent: "Vào ngày 26/08/2017, VNU Tour 2017 với sự tham gia của hơn 50 đội chơi cùng nhau tranh tài. Vượt qua 20 câu hỏi chính thức và 10 câu hỏi phụ đa dạng thể loại. Cuối cùng, BTC cũng đã chọn ra được 21 đội chơi xuất sắc tiến thẳng đến vòng Chung kết. " },
  { year: 2018, images: [vnu2018], shortContent: "", detailedContent: "Trải qua vòng loại diễn ra vào ngày 16/10/2018 vô cùng kịch tính, gây cấn, hấp dẫn cũng như không thiếu những tiếng cười tại Giảng đường 1 - UIT. BTC đã chọn ra được 20 đội chơi cực kì xuất sắc tiến thẳng vào Chung kết VNU Tour 2018 diễn ra vào ngày 21/10/2018." },
  { year: 2019, images: [vnu2019], shortContent: "", detailedContent: "VNU Tour 2019 đã trải qua hai vòng thi đầy thử thách. Vòng loại, diễn ra vào ngày 14/10/2019, gồm hai phần: Kiến thức và Kỹ năng mềm. Từ đây, 12 đội xuất sắc nhất đã bước vào vòng Chung kết, tổ chức vào ngày 20/10/2019. Sau những màn so tài gay cấn, giải Đặc biệt với giá trị 1.414.000 đồng đã được trao cho đội FIVESOME, ghi dấu ấn mạnh mẽ trong lòng người hâm mộ" },
  { year: 2020, images: [vnu2020], shortContent: "", detailedContent: "Vòng loại của cuộc thi, diễn ra vào ngày 09/11/2020 tại giảng đường A1 - Đại học CNTT, đã thu hút hơn 395 sinh viên từ 15 trường đại học khác nhau trên địa bàn thành phố Hồ Chí Minh. Các sinh viên được chia thành 79 đội, cùng nhau tranh tài với hy vọng lọt vào top 14 đội xuất sắc nhất để tiến vào vòng Chung kết, diễn ra vào ngày 15/11/2020. Mặc cho cái nắng chói chang, các đội đã thể hiện sự nhiệt huyết và tinh thần máu lửa của một chiến binh trong suốt quá trình tham gia, đối mặt với hàng loạt thử thách đầy cam go mà Ban tổ chức đã đề ra. Bằng sự năng nổ, thông minh, và quyết tâm, các phi hành đoàn đã hoàn thành xuất sắc nhiệm vụ, và cuối cùng, chủ nhân của giải thưởng 1.515.000 đồng đã lộ diện. Đội DT3S đã xuất sắc giành lấy giải Đặc biệt, khép lại chặng hành trình của các phi hành đoàn tại VNU Tour 2020." },
  { year: 2022, images: [vnu2022], title: "Lê Gia Kỳ Án", shortContent: "Lê Gia Kỳ Án", detailedContent: "Tuy không thể tổ chức vào năm 2021 do ảnh hưởng của đại dịch Covid-19, nhưng VNU Tour đã trở lại mạnh mẽ vào năm 2022 với một diện mạo mới mang tên 'Lê Gia Kỳ Án', thu hút sự tham gia của gần 50 đội trinh thám. Vòng loại diễn ra vào ngày 15/10/2022 tại giảng đường 1 (A1) - UIT, nơi bầu không khí vô cùng náo nhiệt và sôi động. Với sự dễ thương và nhiệt huyết, 200 sinh viên đến từ các trường đại học khác nhau đã cùng nhau tạo nên một cuộc tranh tài đầy màu sắc. Vượt qua vòng loại kịch tính, gây cấn và hấp dẫn, nhưng cũng không thiếu những tiếng cười tại giảng đường 1, các đội đã phải đối mặt với minigame 'Lội ngược dòng' đầy thử thách và 'hack não'. Kết quả, Ban tổ chức đã chọn ra TOP 17 đội thám tử xuất sắc nhất để tiến vào vòng Chung kết VNU Tour 2022, diễn ra vào ngày 23/10/2022. Cuối cùng, giải Đặc biệt trị giá 1.017.000 đồng đã thuộc về đội Baka team, khép lại một mùa giải đầy thành công và ấn tượng." },
  { year: 2023, images: [vnu2023], title: "Mật ngữ loài hoa", shortContent: "Mật ngữ loài hoa", detailedContent: "Tiếp nối thành công của VNU Tour 2022, VNU Tour 2023 đã trở lại với một diện mạo mới mẻ và thu hút hơn, với tên gọi 'Mật ngữ loài hoa'. Hành trình khám phá khu đô thị Đại học Quốc gia năm 2023 đã quy tụ đông đảo sinh viên từ khắp các trường đại học trên địa bàn Thành phố Hồ Chí Minh, tạo nên một bầu không khí hào hứng và sôi động. Vòng loại VNU Tour 2023 đã ghi nhận sự tham gia của 60 đội thi, mang đến một cuộc tranh tài cam go, kịch tính và đầy ấn tượng từ các thí sinh. Ngày 01/10/2023 - Chung kết VNU Tour 2023 diễn ra với sự góp mặt của TOP 18 đội chơi xuất sắc nhất. Sau một ngày thi đấu đầy nhiệt huyết, cùng những phút giây thật tuyệt vời bên nhau, cuối cùng giải đặc biệt trị giá 1.018.000 đồng đã thuộc về Bầy Ong Chăm Chỉ, cùng với những phần thưởng phụ, những suất học bổng thuộc về các đội chơi khác với tổng giá trị lên đến 5.000.000 đồng. VNU Tour 2023 chính thức khép lại, đánh dấu một mùa giải thành công và đầy ấn tượng" },
  { year: 2024, images: [vnu2024], title: "Dạ Khúc U Minh", shortContent: "Dạ Khúc U Minh", detailedContent: "VNUTour 2024 với chủ đề 'Dạ khúc u minh' đã thử thách các bạn tân sinh viên hóa thân thành thám tử để giải quyết vụ án bí ẩn ở gánh hát. Chương trình may mắn được các bạn thí sinh đón nhận nồng nhiệt với sự tham gia của hơn 60 đội thi và 300 thí sinh đến từ các trường đại học trên địa bàn Thành phố Hồ Chí Minh. Mặc dù phải những thử thách khó nhằn được đặt ra xuyên suốt hành trình “phá án”, các thám tử tập sự vẫn xuất sắc vượt qua và để lại nhiều dấu ấn đáng nhớ với đội chiến thắng chung cuộc thuộc về đội chơi 'Ngũ đại ăn hại'. " },
  { year: 2025, images: [vnu2025], title: "Ấn Linh Phong", shortContent: "Ấn Linh Phong", detailedContent: "Tiếp nối thành công đó, VNU Tour 2025 trở lại với chủ đề “Ấn Linh Phong” và nhanh chóng tạo nên một cơn sốt khi thu hút sự góp mặt của hơn 100 đội thi cùng 450 thí sinh nhiệt huyết đến từ khắp các trường đại học. Khoác lên mình tinh thần phiêu lưu và giải mã những bí ẩn kỳ bí, các bạn Tân sinh viên tiếp tục bước vào một hành trình trải nghiệm đầy kịch tính. Dù đối mặt với hệ thống thử thách 'cân não' và vô vàn thử thách ngờ từ ban tổ chức, những nhà thám hiểm tài ba vẫn xuất sắc chinh phục phần thưởng trị với tổng giá trị lên đến 29.000.000 đồng đến từ BTC." },
  { year: 2026, images: [vnu2026], title: "Theo dấu Hải Trình", shortContent: "Theo dấu Hải Trình", detailedContent: "Đến với năm 2026 chuyến phiêu lưu mới vừa bắt đầu, các 'Út cưng' đã sẵn sàng tham gia Đại hải trình này chưa??"},
]

// Pre-calculated percentage coordinates for the 3-row serpentine grid (Desktop)
const desktopLayout = [
  { x: 10, y: 15 },
  { x: 30, y: 15 },
  { x: 50, y: 15 },
  { x: 70, y: 15 },
  { x: 90, y: 15 },
  { x: 90, y: 45 },
  { x: 70, y: 45 },
  { x: 50, y: 45 },
  { x: 30, y: 45 },
  { x: 10, y: 45 },
  { x: 10, y: 75 },
  { x: 34, y: 75 },
  { x: 58, y: 75 },
  { x: 86, y: 75 },
]

const mergedItems = journeyData.map((item, index) => ({
  ...item,
  ...desktopLayout[index],
}))

export default function VNUTourJourneyMap() {
  const [selectedYear, setSelectedYear] = useState(null)

  // Handle modal interactions (ESC key and scroll lock)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setSelectedYear(null)
    }

    if (selectedYear) {
      document.addEventListener('keydown', handleKeyDown)
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = 'unset'
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = 'unset'
    }
  }, [selectedYear])

  return (
    <div className="relative mx-auto w-full max-w-[1300px] overflow-hidden px-5 pt-8 pb-12 md:px-8 md:pt-10 md:pb-16 xl:px-0">

      {/* SECTION HEADER */}
      <Reveal className="mb-2 flex flex-col items-center text-center md:mb-4">
        <h2 className="text-4xl font-extrabold uppercase leading-[1.1] tracking-tight text-[#0c1d33] sm:text-5xl md:text-7xl">
          Hành trình <span className="text-[#1478D4]">VNUTOUR</span>
        </h2>
      </Reveal>

      {/* MAP CONTAINER */}
      <div className="relative mx-auto w-full max-w-[1200px]">

        {/* MOBILE FALLBACK VERTICAL PATH */}
        <div className="absolute bottom-0 left-[23px] top-4 w-[2px] border-l-[3px] border-dashed border-[#1478D4]/30 md:hidden"></div>        {/* EXTENSIVE BACKGROUND DECORATIVE LAYER (Desktop only) */}
        <div className="absolute inset-0 pointer-events-none hidden md:block -z-10">

          {/* TITLE TO 2012 AREA */}
          <svg className="absolute left-[32%] top-[5%] w-6 h-6 text-[#1478D4]/30 -rotate-12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M21 16V14L13 9V3.5C13 2.67 12.33 2 11.5 2C10.67 2 10 2.67 10 3.5V9L2 14V16L10 13.5V19L8 20.5V22L11.5 21L15 22V20.5L13 19V13.5L21 16Z" />
          </svg>
          <svg className="absolute left-[55%] top-[2%] w-8 h-8 text-[#00B6F1]/25" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5L12 2Z" />
          </svg>
          <svg className="absolute left-[18%] top-[10%] w-4 h-4 text-[#1478D4]/40" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C8.13 2 5 5.13 5 9C5 14.25 12 22 12 22C12 22 19 14.25 19 9C19 5.13 15.87 2 12 2ZM12 11.5C10.62 11.5 9.5 10.38 9.5 9C9.5 7.62 10.62 6.5 12 6.5C13.38 6.5 14.5 7.62 14.5 9C14.5 10.38 13.38 11.5 12 11.5Z" />
          </svg>
          <svg className="absolute left-[40%] top-[8%] w-10 h-10 text-[#1478D4]/15" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4C9.11 4 6.6 5.64 5.35 8.04C2.34 8.36 0 10.91 0 14C0 17.31 2.69 20 6 20H19C21.76 20 24 17.76 24 15C24 12.36 21.95 10.22 19.35 10.04Z" />
          </svg>

          {/* AROUND ROW 1 & FIRST U-TURN (2016 -> 2017) */}
          <div className="absolute right-[2%] top-[25%] opacity-20 text-[#1478D4]">
            <svg width="120" height="60" viewBox="0 0 120 60" fill="currentColor">
              <path d="M 30,60 L 60,20 L 90,60 Z" />
              <path d="M 10,60 L 40,30 L 70,60 Z" className="opacity-70" />
              <path d="M 60,60 L 90,10 L 120,60 Z" className="opacity-50" />
            </svg>
          </div>
          <svg className="absolute right-[12%] top-[35%] w-6 h-6 text-[#00B6F1]/30" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2L13.5 9.5L21 11L13.5 12.5L12 20L10.5 12.5L3 11L10.5 9.5L12 2Z" />
          </svg>
          <svg className="absolute right-[20%] top-[22%] w-8 h-8 text-[#1478D4]/15" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4C9.11 4 6.6 5.64 5.35 8.04C2.34 8.36 0 10.91 0 14C0 17.31 2.69 20 6 20H19C21.76 20 24 17.76 24 15C24 12.36 21.95 10.22 19.35 10.04Z" />
          </svg>

          {/* ROW 2 (2017-2021) */}
          <svg className="absolute left-[45%] top-[40%] w-5 h-5 text-[#1478D4]/25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="8" width="18" height="12" rx="2" />
            <circle cx="12" cy="14" r="3" />
            <path d="M7 8V6a2 2 0 012-2h6a2 2 0 012 2v2" />
          </svg>
          <svg className="absolute right-[35%] top-[55%] w-6 h-6 text-[#FFD54D]/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="5" fill="currentColor" opacity="0.5" />
            <path d="M12 2v2m0 16v2m10-10h-2M4 12H2m15.36-7.36l-1.41 1.41M5.05 17.95l1.41-1.41m11.31 0l-1.41-1.41M5.05 6.05l1.41 1.41" />
          </svg>
          <svg className="absolute left-[70%] top-[48%] w-4 h-4 text-[#1478D4]/40" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C8.13 2 5 5.13 5 9C5 14.25 12 22 12 22C12 22 19 14.25 19 9C19 5.13 15.87 2 12 2ZM12 11.5C10.62 11.5 9.5 10.38 9.5 9C9.5 7.62 10.62 6.5 12 6.5C13.38 6.5 14.5 7.62 14.5 9C14.5 10.38 13.38 11.5 12 11.5Z" />
          </svg>

          {/* AROUND SECOND U-TURN & ROW 3 (2021 -> 2022) */}
          <svg className="absolute left-[8%] top-[55%] w-6 h-6 text-[#1478D4]/25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="6" y="8" width="12" height="12" rx="2" />
            <path d="M9 8V5a1 1 0 011-1h4a1 1 0 011 1v3M8 12h8M8 16h8" />
          </svg>
          <svg className="absolute left-[22%] top-[80%] w-6 h-6 text-[#1478D4]/30 rotate-[15deg]" viewBox="0 0 24 24" fill="currentColor">
            <path d="M21 16V14L13 9V3.5C13 2.67 12.33 2 11.5 2C10.67 2 10 2.67 10 3.5V9L2 14V16L10 13.5V19L8 20.5V22L11.5 21L15 22V20.5L13 19V13.5L21 16Z" />
          </svg>
          <div className="absolute right-[15%] top-[72%] opacity-15 text-[#1478D4]">
            <svg width="60" height="40" viewBox="0 0 60 40" fill="currentColor">
              <path d="M 20,40 L 30,10 L 40,40 Z" />
              <path d="M 10,40 L 15,25 L 20,40 Z" />
              <path d="M 40,40 L 45,20 L 50,40 Z" />
            </svg>
          </div>
          <svg className="absolute left-[50%] top-[85%] w-8 h-8 text-[#00B6F1]/20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5L12 2Z" />
          </svg>

        </div>

        {/* DESKTOP SERPENTINE SVG PATH & CONTOURS */}
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="pointer-events-none absolute left-0 top-0 -z-20 hidden h-full w-full md:block"
        >
          {/* SUBTLE MAP CONTOUR LINES */}
          <g stroke="#1478D4" strokeWidth="0.5" fill="transparent" vectorEffect="non-scaling-stroke" className="opacity-15">
            <path d="M 65,0 C 70,8 90,12 100,8" />
            <path d="M 60,0 C 65,11 90,16 100,12" />

            <path d="M 0,28 C 12,32 18,48 0,55" />
            <path d="M 0,24 C 15,28 22,50 0,60" />

            <path d="M 100,60 C 80,68 75,85 100,95" />
            <path d="M 100,65 C 75,72 70,88 85,100" />

            {/* MINI BRANCHING DOTTED ROUTES */}
            <path d="M 90,45 C 95,52 85,60 95,65" strokeDasharray="2 2" strokeWidth="1.5" />
            <path d="M 10,45 C 5,38 15,30 5,25" strokeDasharray="2 2" strokeWidth="1.5" />
          </g>

          {/* VISUAL BRIDGE ROUTE */}
          <path
            d="M 50,2 C 50,8 30,12 10,15"
            stroke="#1478D4"
            strokeWidth="1.5"
            strokeDasharray="4 4"
            fill="transparent"
            vectorEffect="non-scaling-stroke"
            className="opacity-40"
          />
          {/* MAIN JOURNEY ROUTE */}
          <path
            d="
              M 0,15 
              Q 5,12 10,15
              Q 20,18 30,15
              Q 40,12 50,15
              Q 60,18 70,15
              Q 80,12 90,15
              C 100,15 100,45 90,45
              Q 80,48 70,45
              Q 60,42 50,45
              Q 40,48 30,45
              Q 20,42 10,45
              C 0,45 0,75 10,75
              Q 22,78 34,75
              Q 46,72 58,75
              Q 72,78 86,75
            "
            stroke="#1478D4"
            strokeWidth="3"
            strokeDasharray="8 8"
            strokeLinecap="round"
            fill="transparent"
            vectorEffect="non-scaling-stroke"
            className="opacity-50"
          />
        </svg>

        {/* ITEMS RENDER */}
        <div className="relative flex flex-col gap-10 md:block md:h-[850px] md:w-full md:gap-0">

          {mergedItems.map((item) => {

            return (
              <React.Fragment key={item.year}>
                {/* DYNAMIC CSS FOR DESKTOP POSITIONING */}
                <style>{`
                  .map-node-${item.year} {
                    position: relative;
                  }
                  @media (min-width: 768px) {
                    .map-node-${item.year} {
                      position: absolute !important;
                      left: ${item.x}% !important;
                      top: ${item.y}% !important;
                      transform: translateX(-50%) !important;
                    }
                  }
                `}</style>

                <div
                  className={`group map-node-${item.year} flex w-full cursor-pointer items-start md:w-auto md:flex-col md:items-center md:pt-8 hover:z-50 transition-all duration-300`}
                  onDoubleClick={() => setSelectedYear(item)}
                  title="Double-click for details"
                >

                  {/* NODE MARKER */}
                  <div className="absolute left-[24px] top-0 z-10 -translate-x-1/2 -translate-y-1/2 md:left-1/2 flex h-6 w-6 items-center justify-center">
                    {item.isCurrent && (
                      <div className="absolute h-10 w-10 rounded-full bg-[#1478D4] opacity-40 animate-ping"></div>
                    )}
                    <div
                      className={`relative z-10 rounded-full border-[3px] bg-white shadow-md transition-all duration-300 group-hover:scale-[1.6] ${item.isCurrent
                        ? 'h-6 w-6 border-[#1478D4] bg-[#1478D4] shadow-[0_0_20px_rgba(20,120,212,0.8)] group-hover:bg-[#1478D4] group-hover:shadow-[0_0_25px_rgba(20,120,212,1)] group-hover:border-white'
                        : 'h-4 w-4 border-[#1478D4] group-hover:bg-[#1478D4] group-hover:shadow-[0_0_15px_rgba(20,120,212,0.6)]'
                        }`}
                    ></div>
                    {item.isCurrent && (
                      <span className="absolute -top-7 whitespace-nowrap rounded-full bg-[#1478D4]/90 px-[6px] py-[2px] text-[9px] font-extrabold uppercase tracking-[0.1em] text-white shadow-sm backdrop-blur-sm transition-transform group-hover:-translate-y-1">NOW</span>
                    )}
                  </div>

                  {/* CONTENT (YEAR + IMAGE) */}
                  <div className="relative flex w-full flex-col items-start pl-16 md:w-auto md:items-center md:pl-0">

                    {/* TOOLTIP */}
                    <div className="pointer-events-none absolute bottom-[100%] left-16 z-50 mb-2 w-[220px] -translate-y-2 opacity-0 transition-all duration-300 ease-out group-hover:translate-y-0 group-hover:opacity-100 md:left-1/2 md:-translate-x-1/2 md:mb-4 md:w-[260px]">
                      <div className="relative rounded-2xl bg-white/90 backdrop-blur-md p-4 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.15)] ring-1 ring-white/50 border border-white/40">
                        <h4 className="mb-1 text-sm font-bold text-[#1478D4]">Năm {item.year}</h4>
                        <p className="text-sm leading-relaxed text-gray-700">{item.shortContent}</p>
                        {/* Arrow */}
                        <div className="absolute left-6 top-full -mt-[1px] border-[6px] border-transparent border-t-white/90 md:left-1/2 md:-translate-x-1/2"></div>
                      </div>
                    </div>

                    <Reveal delay={100} className="flex flex-col items-start md:items-center">

                      {/* YEAR TYPOGRAPHY */}
                      <span className={`font-extrabold leading-none text-[#0c1d33] drop-shadow-sm transition-colors duration-300 group-hover:text-[#1478D4] ${item.isCurrent ? 'mb-2 text-3xl text-[#1478D4] md:mb-3 md:text-5xl group-hover:drop-shadow-[0_0_12px_rgba(20,120,212,0.4)]' : 'mb-2 text-2xl md:mb-3 md:text-[32px]'}`}>
                        {item.year}
                      </span>

                      {/* COMPACT IMAGES */}
                      <div className="flex w-full gap-2 md:w-[160px] lg:w-[200px]">
                        {item.images.map((imgSrc, imgIndex) => (
                          <div
                            className={`relative aspect-[3/2] w-full overflow-hidden rounded-xl border border-black/5 bg-[#E8FAFF] shadow-md transition-all duration-300 group-hover:-translate-y-1 group-hover:shadow-[0_8px_30px_rgb(20,120,212,0.25)] group-hover:ring-2 group-hover:ring-[#1478D4]/40 group-hover:scale-[1.03] ${item.isCurrent ? 'ring-1 ring-[#1478D4]/30 shadow-[0_4px_20px_rgb(20,120,212,0.15)]' : ''}`}
                          >
                            <img
                              src={imgSrc}
                              alt={`Khoảnh khắc VNUTour ${item.year} - ${imgIndex + 1}`}
                              loading="lazy"
                              className="h-full w-full object-cover object-center transition-transform duration-500"
                            />
                            <div className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-black/10 transition-colors duration-300 group-hover:ring-black/0"></div>
                          </div>
                        ))}
                      </div>

                    </Reveal>
                  </div>

                </div>
              </React.Fragment>
            )
          })}

        </div>
      </div>

      {/* FULL SCREEN DETAILED MODAL */}
      <div
        className={`fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 md:p-12 transition-all duration-400 ${selectedYear ? 'opacity-100 visible' : 'opacity-0 invisible pointer-events-none'}`}
      >
        {/* Backdrop (Dark semi-transparent + Blur) */}
        <div
          className={`absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-400 ${selectedYear ? 'opacity-100' : 'opacity-0'}`}
          onClick={() => setSelectedYear(null)}
        ></div>

        {/* Modal Content Panel */}
        <div
          className={`relative flex w-full max-w-5xl max-h-full flex-col overflow-hidden rounded-[24px] bg-white shadow-2xl transition-all duration-400 ease-out md:flex-row transform ${selectedYear ? 'scale-100 translate-y-0 opacity-100' : 'scale-95 translate-y-8 opacity-0'}`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Close Button */}
          <button
            className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/20 text-white backdrop-blur-md transition-all hover:bg-black/40 hover:scale-105 md:right-6 md:top-6"
            onClick={() => setSelectedYear(null)}
            title="Close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* Left: Large Image */}
          <div className="relative h-64 w-full shrink-0 bg-gray-100 sm:h-80 md:h-auto md:w-5/12 lg:w-1/2">
            {selectedYear && (
              <img
                src={selectedYear.images[0]}
                alt={`VNU TOUR ${selectedYear.year}`}
                className="h-full w-full object-contain p-4"
              />
            )}
          </div>

          {/* Right: Content */}
          <div className="flex w-full flex-col overflow-y-auto p-6 sm:p-8 md:w-7/12 md:p-10 lg:w-1/2 lg:p-12">
            <span className="mb-1 text-5xl font-extrabold tracking-tight text-[#1478D4] md:text-6xl">{selectedYear?.year}</span>
            <h3 className="mb-6 text-2xl font-bold uppercase text-[#0c1d33] md:text-3xl">
              {selectedYear?.title || `VNU TOUR ${selectedYear?.year}`}
            </h3>

            <div className="text-base leading-relaxed text-gray-600 md:text-lg">
              <p>{selectedYear?.detailedContent}</p>
            </div>
          </div>
        </div>
      </div>

    </div>
  )
}
