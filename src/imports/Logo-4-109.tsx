import svgPaths from "./svg-e2j9eghltp";
type LogoProps = {
  className?: string;
  theme?: "Dark" | "Light";
};

function Logo({ className, theme = "Light" }: LogoProps) {
  const isDark = theme === "Dark";
  return (
    <div className={className || `overflow-clip relative rounded-[4px] size-[24px] ${isDark ? "bg-black" : "bg-white"}`}>
      <div className="-translate-x-1/2 absolute aspect-[16/16] bottom-[16.67%] left-1/2 top-[16.67%]" data-name="Vector 1 (Stroke)">
        <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 16 16">
          <path d={svgPaths.pec7580} fill={isDark ? "var(--fill-0, white)" : "var(--fill-0, black)"} id="Vector 1 (Stroke)" />
        </svg>
      </div>
    </div>
  );
}

export default function Logo1() {
  return <Logo className="bg-black overflow-clip relative rounded-[4px] size-full" theme="Dark" />;
}