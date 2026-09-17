export interface Project {
  name: string;
  description: string;
  image?: string;
  github?: string;
  demo?: string;
  appStore?: string;
  playStore?: string;
  devLog?: string;
  status?: string;
}

export type ProjectCategory = 'web' | 'game';

export const projects: Record<ProjectCategory, Project[]> = {
  web: [
    {
      name: '서랍',
      description: '공부하는 사람을 위한 소셜 투두 - 자연어 할 일과 루틴, 독서 기록과 회고, 친구와 응원',
      image: '/images/seorab-preview.png',
      demo: 'https://seorab.team-campfire.dev/',
    },
    {
      name: '그냥수학',
      description: '기초부터 내 속도로 다시 배우는 성인 수학 - 진단 기반 맞춤 추천과 개인 복습 과제',
      image: '/images/geunyang-math-preview.png',
      demo: 'https://geunyang-math.team-campfire.dev/',
      status: 'In Development',
    },
  ],
  game: [
    {
      name: '무한의 기둥 - Infinity Column',
      description: '전략과 순발력이 필요한 중독성 있는 블록 퍼즐 게임',
      image: '/images/infinity-column.png',
      appStore: 'https://apps.apple.com/us/app/infinity-column/id6743107597',
      playStore:
        'https://play.google.com/store/apps/details?id=com.TeamCampfire.InfinityColumn',
      devLog: 'https://dbsckdqja75.tistory.com/category/Unity',
      status: 'Live',
    },
  ],
};
