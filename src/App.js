//import logo from './logo.svg';
import './App.css';

let lastScrollY = window.scrollY;
const header = document.querySelector("header");

window.addEventListener("scroll", () => {
    if (window.scrollY > lastScrollY) {
        // 아래로 스크롤하면 숨김
        header.classList.add("hidden");
    } else {
        // 위로 스크롤하면 나타남
        header.classList.remove("hidden");
    }
    lastScrollY = window.scrollY;
});

function App() {
  return (
    <div className="App">
      <header className="App-header">
      </header>
    </div>
  );
}

export default App;