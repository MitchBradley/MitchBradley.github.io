import * as classes from "./header.module.css";

const logoUrl = new URL("../../assets/logo.svg", import.meta.url);

const Header = () => {
  return (
    <nav
      className={classes.nav + " navbar navbar-expand-lg navbar-dark bg-dark"}
    >
      <div className="container-fluid">
        <a className="navbar-brand" href="#">
          <img className={classes.logo} src={logoUrl} alt="logo" />
        </a>
      </div>
    </nav>
  );
};
export default Header;
