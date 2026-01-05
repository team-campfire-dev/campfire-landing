import React, { useState, useMemo } from 'react';
import './App.css';
import { projects } from './data/projects';

function App() {
    const [selectedCategory, setSelectedCategory] = useState(null);

    const particles = useMemo(() => {
        return [...Array(50)].map(() => ({
            // Start from center (50%) with slight random offset
            left: 50 + (Math.random() - 0.5) * 20,
            delay: Math.random() * -5,
            duration: 2 + Math.random() * 3,
            size: 3 + Math.random() * 6,
            // Sway more as they go up
            sway: (Math.random() - 0.5) * 60
        }));
    }, []);

    const handleCategoryClick = (category) => {
        setSelectedCategory(category);
        window.scrollTo(0, 0);
    };

    const handleBackClick = () => {
        setSelectedCategory(null);
        window.scrollTo(0, 0);
    };

    const renderProjectDetail = () => {
        const categoryProjects = projects[selectedCategory] || [];
        const title = selectedCategory === 'web' ? 'Web Services' : 'Indie Games';

        return (
            <section className="project-detail">
                <h2>{title}</h2>
                <div className="project-list">
                    {categoryProjects.length > 0 ? (
                        categoryProjects.map((project, index) => (
                            <div key={index} className="project-card">
                                {project.image && (
                                    <div className="project-image-wrapper">
                                        <img src={project.image} alt={project.name} className="project-image" />
                                    </div>
                                )}
                                <div className="project-content">
                                    <h3>{project.name}</h3>
                                    <p>{project.description}</p>
                                    <div className="project-links">
                                        {project.github && (
                                            <a href={project.github} target="_blank" rel="noopener noreferrer" className="btn-link">
                                                GitHub
                                            </a>
                                        )}
                                        {project.demo && (
                                            <a href={project.demo} target="_blank" rel="noopener noreferrer" className="btn-link">
                                                Demo
                                            </a>
                                        )}
                                        {project.appStore && (
                                            <a href={project.appStore} target="_blank" rel="noopener noreferrer" className="btn-link">
                                                App Store
                                            </a>
                                        )}
                                        {project.playStore && (
                                            <a href={project.playStore} target="_blank" rel="noopener noreferrer" className="btn-link">
                                                Google Play
                                            </a>
                                        )}
                                        {project.devLog && (
                                            <a href={project.devLog} target="_blank" rel="noopener noreferrer" className="btn-link">
                                                Dev Log (Blog)
                                            </a>
                                        )}
                                        {project.status && <span style={{ color: '#666', fontSize: '0.9rem', marginLeft: '10px' }}>{project.status}</span>}
                                    </div>
                                </div>
                            </div>
                        ))
                    ) : (
                        <div className="project-card">
                            <h3>준비중 확인</h3>
                            <p>아직 공개된 프로젝트가 없습니다. 조금만 기다려주세요!</p>
                        </div>
                    )}
                </div>
                <button className="btn-back" onClick={handleBackClick}>
                    ← 돌아가기
                </button>
            </section>
        );
    };

    const members = [
        { name: 'zeratulspc', avatar: 'https://avatars.githubusercontent.com/u/48204767?v=4', url: 'https://github.com/zeratulspc' },
        { name: 'BUILD', avatar: 'https://avatars.githubusercontent.com/u/22255667?v=4', url: 'https://github.com/dbsckdqja75' },
        { name: 'ChanchanCode', avatar: 'https://avatars.githubusercontent.com/u/69672653?v=4', url: 'https://github.com/ChanchanCode' },
        { name: 'hotdogun', avatar: 'https://avatars.githubusercontent.com/u/62146955?v=4', url: 'https://github.com/hotdogun' },
        { name: 'Han', avatar: 'https://avatars.githubusercontent.com/u/49480867?v=4', url: 'https://github.com/DogYoJeong' },
        { name: 'Avenus', avatar: 'https://avatars.githubusercontent.com/u/83414122?v=4', url: 'https://github.com/dltkdghk508' },
    ];

    return (
        <div className="App">
            {/* Show Hero only when no category selected (or keep it if you want) - Let's keep smooth transition by hiding hero on detailed view for focus */}
            {!selectedCategory && (
                <section className="hero-section">
                    <div className="campfire-wrapper">
                        <div className="campfire-container">
                            <div className="flame-base">
                                <div className="fire-light" />
                                <div className="flame red" />
                                <div className="flame orange" />
                                <div className="flame yellow" />
                                <div className="flame white" />
                            </div>
                            <div className="sparks-container">
                                {particles.map((p, i) => (
                                    <div
                                        key={i}
                                        className="fire-particle"
                                        style={{
                                            '--left': `${p.left}%`,
                                            '--delay': `${p.delay}s`,
                                            '--duration': `${p.duration}s`,
                                            '--size': `${p.size}px`,
                                            '--sway': `${p.sway}px`
                                        }}
                                    ></div>
                                ))}
                            </div>
                        </div>
                    </div>
                    <div className="hero-content">
                        <h1 className="hero-title">Team Campfire</h1>
                        <p className="hero-subtitle">여러 분야의 작은 열정들이 만나는 공간</p>
                    </div>
                </section>
            )}

            {/* Main Content or Detail View */}
            {selectedCategory ? (
                renderProjectDetail()
            ) : (
                <section className="about-section">
                    <div className="intro-text">
                        <p>
                            <strong>Team Campfire</strong>는 게임 개발과 소셜 네트워크 서비스 등<br />
                            다양한 방식으로 창의력을 소모할 수 있는 개발자들의 모임입니다.
                        </p>
                        <p>불꽃처럼 뜨겁게, 함께 만들어가는 이야기</p>
                    </div>

                    <div className="card-container">
                        <div className="card" onClick={() => handleCategoryClick('game')} style={{ cursor: 'pointer' }}>
                            <h3>🎮 인디 게임</h3>
                            <p>창의적인 아이디어로 만드는<br />우리만의 즐거움</p>
                        </div>
                        <div className="card" onClick={() => handleCategoryClick('web')} style={{ cursor: 'pointer' }}>
                            <h3>🌐 웹 서비스</h3>
                            <p>사람과 사람을 잇는<br />새로운 소통의 공간</p>
                        </div>
                    </div>

                    <div className="members-section">
                        <h2>Members</h2>
                        <div className="members-grid">
                            {members.map((member, index) => (
                                <a key={index} href={member.url} target="_blank" rel="noopener noreferrer" className="member-card">
                                    <img src={member.avatar} alt={member.name} className="member-avatar" />
                                    <span className="member-name">{member.name}</span>
                                </a>
                            ))}
                        </div>
                    </div>
                </section>
            )}

            {/* Footer / Contact */}
            <footer className="footer" id="contact">
                <div className="contact-links">
                    <a href="https://github.com/team-campfire-dev" target="_blank" rel="noopener noreferrer" className="contact-link">🔗 GitHub</a>
                    <a href="https://teamcampfire.tistory.com/" target="_blank" rel="noopener noreferrer" className="contact-link">📰 블로그</a>
                    <a href="https://discord.gg/Q4zCBrw75X" target="_blank" rel="noopener noreferrer" className="contact-link">💬 Discord</a>
                    <span className="contact-link">📧 Contact (TBD)</span>
                </div>
                <div className="copyright">
                    <p>서울특별시 강북구 도봉로 336-1</p>
                    <p>Copyright © 2025 Team.Campfire - All Rights Reserved.</p>
                </div>
            </footer >
        </div >
    );
}

export default App;
