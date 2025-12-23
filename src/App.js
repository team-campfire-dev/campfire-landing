import React, { useState } from 'react';
import './App.css';
import { projects } from './data/projects';

function App() {
    const [selectedCategory, setSelectedCategory] = useState(null);

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
                                <h3>{project.name}</h3>
                                {project.image && <img src={project.image} alt={project.name} className="project-image" />}
                                <p>{project.description}</p>
                                <div>
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
                                    {project.status && <span style={{ color: '#666', fontSize: '0.9rem', marginLeft: '10px' }}>{project.status}</span>}
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

    return (
        <div className="App">
            {/* Show Hero only when no category selected (or keep it if you want) - Let's keep smooth transition by hiding hero on detailed view for focus */}
            {!selectedCategory && (
                <section className="hero-section">
                    <div className="fire-glow">
                        <div className="fire-particle p1"></div>
                        <div className="fire-particle p2"></div>
                        <div className="fire-particle p3"></div>
                        <div className="fire-particle p4"></div>
                        <div className="fire-particle p5"></div>
                        <div className="fire-particle p6"></div>
                        <div className="fire-particle p7"></div>
                        <div className="fire-particle p8"></div>
                        <div className="fire-particle p9"></div>
                        <div className="fire-particle p10"></div>
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
