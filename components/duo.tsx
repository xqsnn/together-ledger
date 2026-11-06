import { Heart } from 'lucide-react';

/** 账本的双人标志，首页和登录页共用。 */
export default function Duo({ small = false, logo = false }: { small?: boolean; logo?: boolean }) {
  return (
    <div className={`duo ${logo ? 'logo' : small ? 'small' : ''}`} aria-hidden="true">
      <div className="duo-one"><i /><i /><b /></div>
      <div className="duo-two"><i /><i /><b /></div>
      <Heart className="duo-heart" size={logo ? 10 : small ? 13 : 22} fill="currentColor" />
    </div>
  );
}
