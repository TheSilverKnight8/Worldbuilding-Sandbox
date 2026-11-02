// The app's icon: a cream landmass with a bay, a small islet and a red map pin, on navy,
// in the Shop Manual colors. Same drawing as public/favicon.svg and the PNG icons in public/.

const LAND =
  'M9.5 35.5Q9 31 11 27.5Q13 24 16 23.5Q19 23 20.5 19.5Q22 16 25.5 15Q29 14 31 16Q33 18 36 17Q39 16 42 13.5Q45 11 48.5 12Q52 13 53.5 16Q55 19 53 22Q51 25 52.5 28Q54 31 51.5 33.5Q49 36 45.5 34.5Q42 33 40.5 35.5Q39 38 42 40Q45 42 48 44.5Q51 47 49 50Q47 53 43.5 51Q40 49 37 50Q34 51 30.5 48.5Q27 46 24 47.5Q21 49 19 45.5Q17 42 13.5 41Q10 40 9.5 35.5Z';
const ISLET = 'M10.5 51Q9 48 11.5 47Q14 46 15.5 48Q17 50 14.5 52Q12 54 10.5 51Z';
const PIN = 'M29 40C29 40 21.5 31.7 21.5 27A7.5 7.5 0 0 1 36.5 27C36.5 31.7 29 40 29 40Z';

export function AppMark({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} aria-hidden>
      <rect width="64" height="64" rx="12" fill="#002657" />
      <path d={LAND} fill="#faeeda" />
      <path d={ISLET} fill="#faeeda" />
      <path d={PIN} fill="#fc3f3f" />
      <circle cx="29" cy="27" r="2.8" fill="#faeeda" />
    </svg>
  );
}
