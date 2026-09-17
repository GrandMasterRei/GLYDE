export default function Logo({ size = 'sm', subtitle = true }) {
  const large = size === 'lg';

  return (
    <div className={large ? 'flex flex-col items-center' : ''}>
      <div className="flex items-center gap-2">
        <span
          className={`bg-gradient-to-r from-sky-500 to-teal-500 bg-clip-text font-extrabold tracking-[0.18em] text-transparent ${
            large ? 'text-4xl' : 'text-2xl'
          }`}
        >
          GLYDE
        </span>
      </div>
      {subtitle && (
        <p className={`text-slate-500 ${large ? 'mt-1 text-sm' : 'text-xs'}`}>
          Sipariş & Sevkiyat Takibi
        </p>
      )}
    </div>
  );
}
