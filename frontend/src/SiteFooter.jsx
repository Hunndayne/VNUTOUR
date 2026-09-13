import logoImage from './assets/vnutour-logo.webp'
import { NavLinks } from './SiteHeader.jsx'

export default function SiteFooter() {
  return (
    <footer className="landing-footer landing-border-faint border-t bg-[#062A3B]">
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-10 px-5 py-12 md:px-8 lg:flex-row lg:items-end lg:justify-between xl:px-0">
        <div className="space-y-8">
          <img
            src={logoImage}
            alt="VNUTour"
            className="h-20 w-20 object-contain drop-shadow-[0_0_16px_rgba(57,213,244,0.32)]"
          />
          <NavLinks className="flex flex-wrap" />
        </div>
        <p className="text-xs uppercase leading-6 tracking-[0.08em] text-white/75">
          Copyright © VNUTour
          <br />
          All rights reserved
        </p>
      </div>
    </footer>
  )
}
