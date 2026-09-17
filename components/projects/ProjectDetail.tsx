import Image from 'next/image';
import Link from 'next/link';
import type { Project } from '@/data/projects';

interface ProjectDetailProps {
  title: string;
  projects: Project[];
}

export default function ProjectDetail({ title, projects }: ProjectDetailProps) {
  return (
    <section className="project-detail">
      <h2>{title}</h2>
      <div className="project-list">
        {projects.length > 0 ? (
          projects.map((project, index) => (
            <div key={index} className="project-card">
              {project.image && (
                <div className="project-image-wrapper">
                  <Image
                    src={project.image}
                    alt={project.name}
                    width={140}
                    height={140}
                    className="project-image"
                  />
                </div>
              )}
              <div className="project-content">
                <h3>{project.name}</h3>
                <p>{project.description}</p>
                <div className="project-links">
                  {project.github && (
                    <a
                      href={project.github}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-link"
                    >
                      GitHub
                    </a>
                  )}
                  {project.demo && (
                    <a
                      href={project.demo}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-link"
                    >
                      바로가기
                    </a>
                  )}
                  {project.appStore && (
                    <a
                      href={project.appStore}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-link"
                    >
                      App Store
                    </a>
                  )}
                  {project.playStore && (
                    <a
                      href={project.playStore}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-link"
                    >
                      Google Play
                    </a>
                  )}
                  {project.devLog && (
                    <a
                      href={project.devLog}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-link"
                    >
                      Dev Log (Blog)
                    </a>
                  )}
                  {project.status && (
                    <span
                      style={{
                        color: '#666',
                        fontSize: '0.9rem',
                        marginLeft: '10px',
                      }}
                    >
                      {project.status}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="project-card">
            <h3>준비중</h3>
            <p>아직 공개된 프로젝트가 없습니다. 조금만 기다려주세요!</p>
          </div>
        )}
      </div>
      <div style={{ textAlign: 'center' }}>
        <Link href="/" className="btn-back">
          ← 돌아가기
        </Link>
      </div>
    </section>
  );
}
