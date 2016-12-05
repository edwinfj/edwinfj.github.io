$(document).ready(function() {
	// open all hyperlinks in the new tab, except links in the banner and blog
	$('#intro a, #olcourse a, .projectitem a').attr('target', '_blank');
	// asign attributes to olcourseitem children
	$('.olcourseitem > div').attr('class', 'flexcontainer flexbottom');
	$('.olcourseitem h2').attr('class', 'col7-l col12-s');
	$('.olcourseitem a').attr('title', 'course link');
	$('.difficulty').attr('class', 'col2-l col12-s difficulty');
	$('.recommend').attr('class', 'col3-l col12-s recommend');

	// set repo link images
	$('.repolink a').html('<img src="images/github.svg" alt="repository" title="repository" class="svg_icon svg_icon_github">')
	// assign attributes to demo project items
	$('.demoLink').attr('title', 'demo');
	$('.projectitem > div').attr('class', 'flexcontainer flexbottom');
	$('.projectitem h2').attr('class', 'col4-l col12-s');
	$('.repolink').attr('class', 'repolink col4-l col6-s');
	$('.titlenote').attr('class', 'titlenote col4-l col6-s');

    // convert difficulty level to corresponding visual effect
    var level = ['beginner', 'intermediate', 'advanced'];
    level.forEach(function(item, index) {
        $(".difficulty:contains(" + item +")").html(item + " " + "&#x25A0;".repeat(1+index) + "&#x25A1;".repeat(2 - index));
    });
    // convert recommend level to corresponding visual effect
    var recommend = [1, 2, 3, 4, 5];
    recommend.forEach(function(item) {
        $(".recommend:contains("+item+")").html("recommend " + "&#x2605;".repeat(item) + "&#x2606;".repeat(5 - item));        
    });

    
});