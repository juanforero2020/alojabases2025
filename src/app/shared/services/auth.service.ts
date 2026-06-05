import { Injectable } from '@angular/core';
import { CanActivate, Router, ActivatedRouteSnapshot } from '@angular/router';
import { AngularFireAuth } from  "@angular/fire/auth";
import { User } from  'firebase';
import { AuthenService } from 'src/app/servicios/authen.service';
import { InactivityService } from './inactivity.service';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class AuthService {
  user: User;
  loggedIn:boolean;
  user2 = { email: '',
  password: ''
  }


  constructor(
    private router: Router,
    public authenService: AuthenService,
    public afAuth: AngularFireAuth,
    private inactivityService: InactivityService
  ) {
    if(localStorage.getItem("logged") == undefined){
      localStorage.setItem("logged", false.toString())
    }
    this.loggedIn = JSON.parse(localStorage.getItem("logged"));
    //this.loggedIn = true;
    console.log(this.loggedIn)
    this.afAuth.auth.onAuthStateChanged(user => {
      if (user){
        this.user = user;
        localStorage.setItem('user', JSON.stringify(this.user.email));
      } else {
        localStorage.setItem('user', null);
      }
    })
  }

  logIn(login: string, password: string): Observable<{ token: string }> {
    this.user2.email = login;
    this.user2.password = password;
    return this.authenService.signIn(this.user2).pipe(
      tap(res => {
        localStorage.setItem('token', res.token);
        this.loggedIn = true;
        localStorage.setItem('logged', this.loggedIn.toString());
        this.inactivityService.startWatching(() => this.logOut(true));
        this.router.navigate(['/']);
      })
    );
  }


  async loginIn(){
    try{
      if("token" in localStorage)
        this.router.navigate(['/home']);
    }catch(e){}
  }

  async logOut(porInactividad?: boolean) {
    this.inactivityService.stopWatching();
    await this.afAuth.auth.signOut();
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    localStorage.removeItem('rol');
    this.loggedIn = false;
    localStorage.setItem("logged", this.loggedIn.toString());
    if (porInactividad) {
      alert('Su sesión ha sido cerrada por inactividad. Por favor, inicie sesión nuevamente.');
    }
    this.router.navigate(['/login-form']);
  }

  get isLoggedIn() {
    return this.loggedIn;
  }
}

@Injectable()
export class AuthGuardService implements CanActivate {
    constructor(private router: Router, private authService: AuthService, public authenService:AuthenService) {}
    role = ''
    canActivate(route: ActivatedRouteSnapshot): boolean {
        const url = route.routeConfig.path;
        const isLoggedIn = this.authService.isLoggedIn;
        const isLoginForm = route.routeConfig.path === 'login-form';

        if (isLoggedIn && isLoginForm) {
          this.router.navigate(['/']);
          return false;
        }

        if (!isLoggedIn && !isLoginForm) {
          this.router.navigate(['/login-form']);
        }

        return isLoggedIn || isLoginForm;
    }
}
