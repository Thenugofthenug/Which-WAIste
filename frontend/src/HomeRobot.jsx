export default function HomeRobot({ variant = 'home' }) {
  return <div className={variant === 'heading' ? 'heading-robot-layer' : 'home-robot-layer'} aria-hidden="true">
    <div className="home-robot-wander">
      <div className="home-robot-bob">
        <svg viewBox="-8 -32 136 232" className="home-robot-art">
          <g className="home-robot-facing">
            <g className="home-robot-front">
              <path d="M0 0h120v90H0zM20 90h80v50H20z" fill="#575078" stroke="#c2bbd6" strokeWidth="6" />
              <g className="robot-face-features">
                <rect className="robot-eye" x="20" y="24" width="22" height="22" fill="#75e5f5" />
                <rect className="robot-eye" x="78" y="24" width="22" height="22" fill="#75e5f5" />
                <path d="M30 68h60" stroke="#75e5f5" strokeWidth="6" />
              </g>
              <path className="robot-antenna" d={variant === 'heading' ? 'M60 0v-20h16' : 'M60 0v-22'} fill="none" stroke="#75e5f5" strokeWidth="6" />
            </g>
            <g className="home-robot-side">
              <path d="M28 0h64v90H28zM38 90h48v50H38z" fill="#575078" stroke="#c2bbd6" strokeWidth="6" />
              <path d="M28 0h18v90H28zM38 94h12v43H38z" fill="#575078" />
              <rect className="robot-eye" x="68" y="24" width="18" height="22" fill="#75e5f5" />
              <path d="M72 68h16M60 0v-22" stroke="#75e5f5" strokeWidth="6" />
            </g>
          </g>
          <g stroke="#75e5f5" strokeWidth="5">
            {[80, 56, 32].map((width, index) => <line key={width} className="robot-hover-line" x1={60 - width / 2} x2={60 + width / 2} y1={156 + index * 14} y2={156 + index * 14} style={{ animationDelay: `${index * .2}s` }} />)}
          </g>
        </svg>
      </div>
    </div>
  </div>
}
